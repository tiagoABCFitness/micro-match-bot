// src/matcher.js
require('dotenv').config();
const { getAllResponses } = require('./db');
const slackClient = require('./slackClient');
const ai = require('./ai');

function sanitizeChannelName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);
}

function todayStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function ensureChannel(name, isPrivate = true) {
    const channelName = sanitizeChannelName(name);
    try {
        const res = await slackClient.conversations.create({ name: channelName, is_private: isPrivate });
        return res.channel.id;
    } catch (err) {
        if (err.data?.error === 'name_taken') {
            const suffix = Math.random().toString(36).slice(2, 6);
            const altName = sanitizeChannelName(`${channelName}-${suffix}`);
            const res = await slackClient.conversations.create({ name: altName, is_private: isPrivate });
            return res.channel.id;
        }
        throw err;
    }
}

async function inviteAndWelcome(channelId, users, topic, mode) {
    if (!users?.length) return;
    await slackClient.conversations.invite({ channel: channelId, users: users.join(',') });

    const isPair = users.length === 2 && mode === '1:1';
    const opener = isPair
        ? `You’ve been paired 1:1 on *${topic}* 👋\nTry this: *What’s one underrated thing about ${topic}?*`
        : `You’ve been matched on *${topic}* 🎉 (group of ${users.length})\nStarter: *What’s something new you learned about ${topic} recently?*`;

    await slackClient.chat.postMessage({ channel: channelId, text: opener });
}

function splitPairs(userIds) {
    const pairs = [];
    const shuffled = [...userIds].sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < shuffled.length; i += 2) pairs.push([shuffled[i], shuffled[i + 1]]);
    const leftover = shuffled.length % 2 === 1 ? [shuffled[shuffled.length - 1]] : [];
    return { pairs, leftover };
}

async function runMatcher() {
    const responses = await getAllResponses();

    //To test manually, uncomment this and provide sample data:
    // const responses = [
    //     { userId: 'U01', topics: ['nintendo', 'fitness'], preference: '1:1' },
    //     { userId: 'U02', topics: ['ps', 'fitness'], preference: '1:1' },
    //     { userId: 'U03', topics: ['gaming'], preference: 'group' },
    //     { userId: 'U04', topics: ['gaming'], preference: 'group' },
    //     { userId: 'U05', topics: ['dance'], preference: 'group' }, // põe mais para testar sharding
    // ];

    if (!responses || responses.length < 2) {
        console.log('Not enough users to match.');
        return;
    }

    for (const r of responses) {
        if (!r.preference) r.preference = 'group';
        if (!Array.isArray(r.topics)) r.topics = [];
    }

    const allTopics = Array.from(new Set(
        responses.flatMap(r => r.topics.map(t => String(t).trim().toLowerCase())).filter(Boolean)
    ));
    const mapping = await ai.canonicalizeTopics(allTopics);

    for (const t of allTopics) {
        if (!mapping[t]) mapping[t] = t;
    }

    const byTopic = new Map();
    for (const { userId, topics, preference } of responses) {
        const canonTopics = Array.from(new Set(topics.map(
            t => mapping[String(t).trim().toLowerCase()] || String(t).trim().toLowerCase()
        )));
        for (const ct of canonTopics) {
            if (!byTopic.has(ct)) byTopic.set(ct, { group: new Set(), pref1v1: new Set() });
            if (preference === '1:1') byTopic.get(ct).pref1v1.add(userId);
            else byTopic.get(ct).group.add(userId);
        }
    }

    const stamp = todayStamp();
    const created = [];
    const matchedUsers = new Set();

    // Criar pares 1:1 primeiro
    for (const [topic, buckets] of byTopic) {
        const oneOnOneIds = Array.from(buckets.pref1v1);
        if (oneOnOneIds.length >= 2) {
            const { pairs, leftover } = splitPairs(oneOnOneIds);
            for (const [a, b] of pairs) {
                try {
                    const raw = `micromatch-${topic}-duo-${stamp}`;
                    const channelId = await ensureChannel(raw, true);
                    await inviteAndWelcome(channelId, [a, b], topic, '1:1');
                    created.push({ topic, type: '1:1', users: [a, b] });
                    matchedUsers.add(a); matchedUsers.add(b);
                    buckets.group.delete(a); buckets.group.delete(b);
                } catch (err) {
                    console.error(`Error creating 1:1 channel for topic "${topic}":`, err.message);
                }
            }
            for (const u of leftover) buckets.group.add(u);
        }
    }

    // Criar grupos (garantir que ninguém com match fica sozinho)
    for (const [topic, buckets] of byTopic) {
        const groupUsers = Array.from(buckets.group);
        if (groupUsers.length >= 2) {
            try {
                let batches = [];
                if (groupUsers.length > 10) {
                    // dividir em lotes de 10, mas juntar sobra de 1 ao último batch
                    const fullBatches = Math.floor(groupUsers.length / 10);
                    for (let i = 0; i < fullBatches; i++) {
                        batches.push(groupUsers.slice(i * 10, (i + 1) * 10));
                    }
                    const leftover = groupUsers.slice(fullBatches * 10);
                    if (leftover.length === 1) {
                        batches[batches.length - 1].push(leftover[0]); // fica 11
                    } else if (leftover.length > 1) {
                        batches.push(leftover);
                    }
                } else {
                    batches = [groupUsers];
                }

                for (let i = 0; i < batches.length; i++) {
                    const suffix = batches.length > 1 ? `-${i + 1}` : '';
                    const raw = `micromatch-${topic}-grp-${stamp}${suffix}`;
                    const channelId = await ensureChannel(raw, true);
                    await inviteAndWelcome(channelId, batches[i], topic, 'group');
                    created.push({ topic, type: 'group', users: batches[i] });
                    for (const u of batches[i]) matchedUsers.add(u);
                }
            } catch (err) {
                console.error(`Error creating group channel for topic "${topic}":`, err.message);
            }
        }
    }

    // Quem não entrou em nenhum match
    const allUserIds = responses.map(r => r.userId);
    const unmatched = allUserIds.filter(u => !matchedUsers.has(u));

    if (unmatched.length) {
        console.log(`Users sem match: ${unmatched.join(', ')}`);
        // ⚠️ Aqui apenas sinalizamos — o envio de DM com botões deve ser feito no server.js
        // Sugestão: enviar Block Kit com lista de tópicos que têm grupo disponível (created.filter(c => c.type==='group')).
    }

    if (!created.length) console.log('No channels created (insufficient overlaps).');
    else console.log(`Created ${created.length} channel(s).`);


    return { created, unmatched };
}

if (require.main === module) {
    runMatcher().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runMatcher };
