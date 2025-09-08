// src/matcher.js
require('dotenv').config();
const slackClient = require('./slackClient');
const ai = require('./ai');
const { getAllResponses, addUnmatchedUsersForWeek,
    getUnmatchedUsersForWeek} = require('./db'); // sempre existe

// opcional: só usamos se existirem no db.js
let upsertMatchRoom, addMatchParticipants;
try {
    ({ upsertMatchRoom, addMatchParticipants } = require('./db'));
} catch { /* ignore */ }

function sanitizeChannelName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);
}

function isoWeekStart(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7; // 1..7, segunda=1
    if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function todayStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function ensureChannel(name, isPrivate = true) {
    const channelName = sanitizeChannelName(name);

    try {
        const res = await slackClient.conversations.create({ name: channelName, is_private: isPrivate });
        if (!res?.channel?.id) throw new Error('conversations.create returned no channel');
        return res.channel.id;
    } catch (err) {
        const code = err?.data?.error || err?.message;
        if (code === 'name_taken') {
            const suffix = Math.random().toString(36).slice(2, 6);
            const altName = sanitizeChannelName(`${channelName}-${suffix}`);
            const res2 = await slackClient.conversations.create({ name: altName, is_private: isPrivate });
            if (!res2?.channel?.id) throw new Error('conversations.create (alt) returned no channel');
            return res2.channel.id;
        }
        throw err;
    }
}

async function inviteAndWelcome(channelId, users, topic, mode) {
    if (!channelId || !Array.isArray(users) || users.length === 0) return;

    try {
        await slackClient.conversations.invite({ channel: channelId, users: users.join(',') });
    } catch (err) {
        const code = err?.data?.error;
        // ignora alguns erros esperados
        if (!['already_in_channel', 'cant_invite_self'].includes(code)) throw err;
    }

    const isPair = users.length === 2 && mode === '1:1';

    // Ice breakers via IA (fallback simples se função não existir/falhar)
    let iceBreakers = [];
    try {
        if (typeof ai.generateIceBreakers === 'function') {
            iceBreakers = await ai.generateIceBreakers(topic, 3);
        }
    } catch (err) {
        console.warn('AI icebreaker generation failed:', err.message);
    }

    const base = isPair
        ? `YWelcome! Meet your Micro-Match for this week! You both share an interest in *${topic}* 👋`
        : `Welcome and meet your micro matches from this week! You are all interested in chatting about*${topic}* 🎉`;

    const questions = Array.isArray(iceBreakers) && iceBreakers.length
        ? `\nHere are some ice breakers:\n${iceBreakers.map(q => `• ${q}`).join('\n')}`
        : `\nStarter: *What’s something new you learned about ${topic} recently?*`;

    const text = `${base}${questions}\n\nReminder: this room gets archived next Monday. Let’s make this micro match count!`;

    await slackClient.chat.postMessage({ channel: channelId, text });
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

    // Sem gente suficiente → nunca devolve undefined
    if (!responses || responses.length < 2) {
        const unmatched = Array.isArray(responses) ? responses.map(r => r.userId) : [];
        console.log(`Not enough users to match. Unmatched: ${unmatched.join(', ')}`);
        // Gravar unmatched no bucket da semana atual
        try {
            const weekBucket = isoWeekStart(new Date());
            if (typeof addUnmatchedUsersForWeek === 'function' && unmatched.length) {
                await addUnmatchedUsersForWeek(weekBucket, unmatched);
            }
        } catch (e) {
            console.warn('addUnmatchedUsersForWeek (early) failed:', e.message);
        }

        return { created: [], unmatched, notEnough: true };
    }

    // Normalizar
    for (const r of responses) {
        if (!r.preference) r.preference = 'group'; // default se não guardas preferência no responses
        if (!Array.isArray(r.topics)) r.topics = [];
    }

    // Canonicalizar tópicos (fallback: identidade)
    const allTopics = Array.from(new Set(
        responses.flatMap(r => r.topics.map(t => String(t).trim().toLowerCase())).filter(Boolean)
    ));

    let mapping = {};
    try {
        if (typeof ai.canonicalizeTopics === 'function') {
            mapping = await ai.canonicalizeTopics(allTopics);
        }
    } catch (e) {
        console.warn('canonicalizeTopics failed (using identity):', e.message);
    }
    mapping = mapping && typeof mapping === 'object' ? mapping : {};
    for (const t of allTopics) if (!mapping[t]) mapping[t] = t;

    // Agrupar por tópico e preferência
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

    // 1) Criar pares 1:1 primeiro
    for (const [topic, buckets] of byTopic) {
        const oneOnOneIds = Array.from(buckets.pref1v1);
        if (oneOnOneIds.length >= 2) {
            const { pairs, leftover } = splitPairs(oneOnOneIds);
            for (const [a, b] of pairs) {
                try {
                    const raw = `micromatch-${topic}-duo-${stamp}`;
                    const channelId = await ensureChannel(raw, true);
                    await inviteAndWelcome(channelId, [a, b], topic, '1:1');

                    // regista sala/participantes (se existir no DB)
                    if (typeof upsertMatchRoom === 'function') {
                        await upsertMatchRoom(channelId);
                    }
                    if (typeof addMatchParticipants === 'function') {
                        await addMatchParticipants(channelId, [a, b]);
                    }

                    created.push({ topic, type: '1:1', channelId, users: [a, b] });
                    matchedUsers.add(a); matchedUsers.add(b);
                    buckets.group.delete(a); buckets.group.delete(b);
                } catch (err) {
                    console.error(`Error creating 1:1 channel for topic "${topic}":`, err.message);
                }
            }
            for (const u of leftover) buckets.group.add(u);
        }
    }

    // 2) Criar grupos (garante que ninguém com match fica sozinho)
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

                    if (typeof upsertMatchRoom === 'function') {
                        await upsertMatchRoom(channelId);
                    }
                    if (typeof addMatchParticipants === 'function') {
                        await addMatchParticipants(channelId, batches[i]);
                    }

                    created.push({ topic, type: 'group', channelId, users: batches[i] });
                    for (const u of batches[i]) matchedUsers.add(u);
                }
            } catch (err) {
                console.error(`Error creating group channel for topic "${topic}":`, err.message);
            }
        }
    }

    // 3) Quem não entrou em nenhum match
    const allUserIds = responses.map(r => r.userId);
    const unmatched = allUserIds.filter(u => !matchedUsers.has(u));

    if (unmatched.length) {
        console.log(`Users without match: ${unmatched.join(', ')}`);
    }

    if (!created.length) console.log('No channels created (insufficient overlaps).');
    else console.log(`Created ${created.length} channel(s).`);

    const weekBucket = isoWeekStart(new Date());
    if (typeof addUnmatchedUsersForWeek === 'function' && unmatched.length) {
        try { await addUnmatchedUsersForWeek(weekBucket, unmatched); }
        catch (e) { console.warn('addUnmatchedUsersForWeek failed:', e.message); }
    }

    return { created, unmatched, notEnough: false };
}

if (require.main === module) {
    runMatcher().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runMatcher };
