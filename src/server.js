// src/server.js
require('dotenv').config();

const express = require('express');
const { WebClient } = require('@slack/web-api');
const app = express();
const { runMatcher } = require('./matcher');

const { countryFunFact, analyzeInterests, culturalTopicSuggestions, detectUserIntent } = require('./ai.js');
const {
    saveResponse,
    getAllResponses,
    clearResponses,
    clearUsers,
    getUser,
    saveUser,
    setUserStatus,
    updateUserCountry,
    getAllUsers,
    updateUserMatchPreference,
    deleteResponsesByUser,
    deleteUser,
    softOptOutUser,
    deleteUserCascade,
    upsertMatchRoom,
    markRoomArchived,
    getActiveRooms,
    upsertCheckinConnected,
    upsertCheckinParticipate
} = require('./db');

const { sendConsentMessage, handleSlackActions, getUserName } = require('./consent');
const slackClient = require('./slackClient');
const {sendNoMatchOptions} = require("./messageHandler");

// ---------- Simple in-memory state ----------
/** userId -> string[] (pending interests to confirm) */
const pendingInterests = new Map();
/** userId -> '1:1' | 'group' (fallback only if DB method is missing) */
const matchPrefMemory = new Map();

// ---------- Helpers ----------
function extractChannelId(body) {
    const evt = body?.event;
    return (
        evt?.channel ||
        body?.channel_id ||
        body?.channel?.id ||
        body?.container?.channel_id ||
        evt?.item?.channel ||
        null
    );
}

function bullets(list) {
    return list.map(i => `• ${i}`).join('\n');
}

/** Replace any actions block with a context note (hides buttons after click) */
function replaceActionsWithNote(blocks, note) {
    const safe = Array.isArray(blocks) ? blocks : [];
    return safe.map(b =>
        b.type === 'actions'
            ? { type: 'context', elements: [{ type: 'mrkdwn', text: note }] }
            : b
    );
}

/** Random sample up to n unique items */
function sample(list, n = 5) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

/** Collect up to `max` unique topics from other users */
async function collectCommunityTopics(currentUserId, max = 5) {
    try {
        const rows = await getAllResponses();
        const pool = new Set();
        const addArr = (arr) => Array.isArray(arr) && arr.forEach(v => {
            const s = String(v || '').trim().toLowerCase();
            if (s) pool.add(s);
        });

        if (Array.isArray(rows)) {
            for (const r of rows) {
                const uid = r?.user_id || r?.userId || r?.slack_id || r?.user || r?.uid;
                if (uid && uid === currentUserId) continue;

                if (Array.isArray(r?.response)) addArr(r.response);
                else if (Array.isArray(r?.responses)) addArr(r.responses);
                else if (Array.isArray(r?.topics)) addArr(r.topics);
                else if (typeof r === 'object' && r) {
                    for (const v of Object.values(r)) {
                        if (Array.isArray(v)) addArr(v);
                    }
                } else if (typeof r === 'string') {
                    const s = r.trim().toLowerCase();
                    if (s) pool.add(s);
                }
            }
        }

        return sample(Array.from(pool), max);
    } catch (e) {
        console.warn('collectCommunityTopics error:', e.message);
        return [];
    }
}

/** Reusable "Suggest topics" action block */
function suggestTopicsButton() {
    return {
        type: 'actions',
        elements: [
            { type: 'button', text: { type: 'plain_text', text: 'Show me topic examples' }, action_id: 'suggest_topics' }
        ]
    };
}

/** Ask for match preference (1:1 vs Group) */
async function askMatchPreference(userId) {
    await slackClient.chat.postMessage({
        channel: userId,
        text: 'Before we match: do you prefer 1:1 or a group conversation?',
        blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: '*Before we match:* do you prefer a 1:1 or a group conversation?' } },
            {
                type: 'actions',
                elements: [
                    { type: 'button', text: { type: 'plain_text', text: '1:1' }, style: 'primary', action_id: 'choose_match_1_1' },
                    { type: 'button', text: { type: 'plain_text', text: 'Group' }, action_id: 'choose_match_group' }
                ]
            }
        ]
    });
    // Enquanto espera a escolha, deixamos o estado explícito
    await setUserStatus(userId, 'awaiting_match_pref');
}

/** Save match preference with DB if available; otherwise memory fallback */
async function saveMatchPref(userId, pref) {
    if (typeof updateUserMatchPreference === 'function') {
        try {
            await updateUserMatchPreference(userId, pref); // implementa no db.js: (user_id TEXT, match_pref TEXT)
            return;
        } catch (e) {
            console.warn('updateUserMatchPreference failed, using memory fallback:', e.message);
        }
    } else {
        console.warn('updateUserMatchPreference not implemented in db.js; using memory fallback.');
    }
    matchPrefMemory.set(userId, pref);
}

// chave simples da “semana” (usa a data do run)
function weekKey(d = new Date()) {
    return d.toISOString().slice(0, 10); // ex.: 2025-09-02
}

// DM check-in (abre IM e envia pergunta Yes/No)
async function askWeeklyCheckin(slack, userId, userName) {
    const open = await slack.conversations.open({ users: userId });
    const imChannel = open?.channel?.id || userId;
    const greeting = userName ? `Hey ${userName},` : 'Hey there,';

    await slack.chat.postMessage({
        channel: imChannel,
        text: `${greeting} time for this week's check-in! Did you have a chance to connect last week?`,
        blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `${greeting} time for this week's check-in! Did you have a chance to connect last week?` } },
            {
                type: 'actions',
                elements: [
                    { type: 'button', text: { type: 'plain_text', text: 'Yes' }, style: 'primary', action_id: 'checkin_connected_yes' },
                    { type: 'button', text: { type: 'plain_text', text: 'No' }, action_id: 'checkin_connected_no' }
                ]
            }
        ]
    });
}


// Slack Events use JSON; Slack Interactivity uses x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- Slack Events (DMs to the bot) ----------
app.post('/slack/events', async (req, res) => {
    const { type, challenge, event } = req.body;

    // URL verification
    if (type === 'url_verification') {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(challenge);
    }

    // Only handle direct messages from humans
    if (event && event.type === 'message' && event.channel_type === 'im' && !event.bot_id) {
        const userId = event.user;
        const userText = (event.text || '').trim();

        try {
            let user = await getUser(userId);

            // ——— Detecta "exit"/"leave" (case-insensitive) e pergunta confirmação
            const lowered = (userText || '').trim().toLowerCase();
            if (lowered === 'exit' || lowered === 'leave') {
                // Se o user existe/registado, pergunta confirmação
                if (user) {
                    await askExitConfirmation(userId);
                } else {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: "You're not registered yet. If you want, just say hi or hello to me!"
                    });
                }
                return res.status(200).send();
            }

            // 1) New user -> start consent
            if (!user) {
                const userName = await getUserName(userId);
                await sendConsentMessage(userId);
                await saveUser(userId, userName, 0, 'awaiting_consent');
                console.log(`New user ${userName} (${userId}) triggered consent flow.`);
                return res.status(200).send();
            }

            // 2) User without consent -> ask again
            if (!user.consent) {
                await sendConsentMessage(userId, { revisit: true });
                await setUserStatus(userId, 'awaiting_consent');
                console.log(`User ${user.name || userId} (${userId}) asked to re-consent.`);
                return res.status(200).send();
            }

            // 3) Waiting for country
            if (user.status === 'awaiting_country') {
                const country = userText;
                if (!country) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: 'Please tell me your country (e.g., Portugal).'
                    });
                    return res.status(200).send();
                }

                await updateUserCountry(userId, country);
                await setUserStatus(userId, 'awaiting_interests_freeform');

                const funFact = await countryFunFact(country).catch(() => null);

                const baseText = `Great — noted ${country}.`;
                const factText = funFact ? `\nDid you know: ${funFact}` : '';
                const followUp = `\nNow, tell me a bit about yourself — what topics would you like to discuss here, or what would you like to learn?`;
                const text = `${baseText}${factText}${followUp}`;

                await slackClient.chat.postMessage({
                    channel: userId,
                    text,
                    blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: baseText + (funFact ? `\n*Fun fact:* ${funFact}` : '') } },
                        { type: 'section', text: { type: 'mrkdwn', text: 'Now, tell me a bit about yourself — what topics would you like to discuss here, or what would you like to learn?' } },
                        { type: 'context', elements: [{ type: 'mrkdwn', text: '_e.g., running, photography, programming, nutrition, English, investing…_' }] },
                        suggestTopicsButton()
                    ]
                });

                return res.status(200).send();
            }

            // 4) Waiting for interests (freeform) OR user added more detail after we suggested bullets
            if (user.status === 'awaiting_interests_freeform' || pendingInterests.has(userId)) {
                if (!userText) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: "Hey again — I've got your interests for this week. If you'd like to change them, tell me a bit about what you'd like to discuss or learn; otherwise you're all set and I'll work on finding you a match.",
                        blocks: [
                            { type: 'section', text: { type: 'mrkdwn', text: "Hey again — I've got your interests for this week. If you'd like to change them, tell me a bit about what you'd like to discuss or learn; otherwise you're all set and I'll work on finding you a match." } },
                            suggestTopicsButton()
                        ]
                    });
                    return res.status(200).send();
                }

                const analysis = await analyzeInterests(userText).catch(() => ({ reply: '', interests: [] }));
                const interests = Array.isArray(analysis.interests) ? analysis.interests : [];

                if (interests.length === 0) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: "I didn't pick up enough interests. Could you add a bit more detail?",
                        blocks: [
                            { type: 'section', text: { type: 'mrkdwn', text: "I didn't pick up enough interests. Could you add a bit more detail?" } },
                            suggestTopicsButton()
                        ]
                    });
                    await setUserStatus(userId, 'awaiting_interests_freeform');
                    return res.status(200).send();
                }

                // Store pending and ask for confirmation
                pendingInterests.set(userId, interests);

                await setUserStatus(userId, 'awaiting_interests_freeform'); // remain in this phase until confirm

                const intro = analysis.reply || 'Thanks! Here is what I caught:';
                const list = bullets(interests);

                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `${intro}\n\nProposed interests:\n${list}`,
                    blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: intro } },
                        { type: 'section', text: { type: 'mrkdwn', text: `*Proposed interests:*\n${list}` } },
                        {
                            type: 'actions',
                            elements: [
                                { type: 'button', text: { type: 'plain_text', text: 'Confirm' }, style: 'primary', action_id: 'confirm_interests' },
                                { type: 'button', text: { type: 'plain_text', text: 'I want to change them' }, action_id: 'refine_interests' }
                            ]
                        }
                    ]
                });

                return res.status(200).send();
            }

            // 5) Awaiting match preference → still allow users to send text to update topics
            if (user.status === 'awaiting_match_pref' && userText) {
                const analysis = await analyzeInterests(userText).catch(() => ({ reply: '', interests: [] }));
                const interests = Array.isArray(analysis.interests) ? analysis.interests : [];

                if (interests.length > 0) {
                    pendingInterests.set(userId, interests);

                    const intro = analysis.reply || 'Got it. Here is what I caught:';
                    const list = bullets(interests);

                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: `${intro}\n\nProposed interests:\n${list}`,
                        blocks: [
                            { type: 'section', text: { type: 'mrkdwn', text: intro } },
                            { type: 'section', text: { type: 'mrkdwn', text: `*Proposed interests:*\n${list}` } },
                            {
                                type: 'actions',
                                elements: [
                                    { type: 'button', text: { type: 'plain_text', text: 'Confirm' }, style: 'primary', action_id: 'confirm_interests' },
                                    { type: 'button', text: { type: 'plain_text', text: 'Give more details' }, action_id: 'refine_interests' }
                                ]
                            }
                        ]
                    });
                    return res.status(200).send();
                }
                // If no interests extracted, gently remind:
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: "I'm ready when you are — you can tell me more interests, or tap one of the options above."
                });
                return res.status(200).send();
            }

            // 6) Active user — friendly small talk OR propose updates from free text
            if (userText) {
                // 1) Primeiro, tenta perceber a intenção (mudar interesses vs. small talk)
                const { country } = user || {};
                const intent = await detectUserIntent(userText, country).catch(() => ({ intent: 'other', reply: '' }));

                if (intent.intent === 'change_interests') {
                    // 2) Segue o fluxo atual: analisar texto e propor bullets
                    const analysis = await analyzeInterests(userText).catch(() => ({ reply: '', interests: [] }));
                    const interests = Array.isArray(analysis.interests) ? analysis.interests : [];

                    if (interests.length === 0) {
                        await slackClient.chat.postMessage({
                            channel: userId,
                            text: "If you'd like to change your topics, tell me a bit about what you'd like to discuss or learn; otherwise you're all set and I'll work on finding you a match.",
                            blocks: [
                                { type: 'section', text: { type: 'mrkdwn', text: "If you'd like to change your topics, tell me a bit about what you'd like to discuss or learn; otherwise you're all set and I'll work on finding you a match." } },
                                suggestTopicsButton()
                            ]
                        });
                        return res.status(200).send();
                    }

                    pendingInterests.set(userId, interests);
                    await setUserStatus(userId, 'awaiting_interests_freeform');

                    const intro = analysis.reply || 'Got it. Here is what I caught:';
                    const list = bullets(interests);

                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: `${intro}\n\nProposed interests:\n${list}`,
                        blocks: [
                            { type: 'section', text: { type: 'mrkdwn', text: intro } },
                            { type: 'section', text: { type: 'mrkdwn', text: `*Proposed interests:*\n${list}` } },
                            {
                                type: 'actions',
                                elements: [
                                    { type: 'button', text: { type: 'plain_text', text: 'Confirm' }, style: 'primary', action_id: 'confirm_interests' },
                                    { type: 'button', text: { type: 'plain_text', text: 'Give more details' }, action_id: 'refine_interests' }
                                ]
                            }
                        ]
                    });

                    return res.status(200).send();
                }

                if (intent.intent === 'bot_questions') {
                    const friendly = "Glad you ask! You can chack everything on the About tab right under my name.";
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: friendly
                    });
                    return res.status(200).send();


                    return res.status(200).send();
                }

                // 3) Se não for para mudar (small talk/other), responde de forma humana e calorosa
                const friendly = intent.reply || "Glad to hear from you! If you ever want to update your interests, just tell me and I’ll suggest a new list.";
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: friendly
                });
                return res.status(200).send();
            }


            // If we get here, there was no text to process
            await slackClient.chat.postMessage({
                channel: userId,
                text: 'Please send a short message about your interests.',
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: 'Please send a short message about your interests.' } },
                    suggestTopicsButton()
                ]
            });
        } catch (err) {
            console.error('Error in /slack/events:', err.message);
        }
    }

    return res.status(200).send();
});

// ---------- Slack Interactivity (buttons) ----------
app.post('/slack/actions', async (req, res) => {
    try {
        const payloadStr = req.body?.payload;
        if (!payloadStr) {
            return handleSlackActions(req, res);
        }

        const payload = JSON.parse(payloadStr);
        if (payload?.type !== 'block_actions') {
            return handleSlackActions(req, res);
        }

        const actionId = payload?.actions?.[0]?.action_id;
        const userId = payload?.user?.id;
        const channel = payload?.channel?.id || payload?.container?.channel_id;
        const ts = payload?.message?.ts || payload?.container?.message_ts;
        const originalBlocks = payload?.message?.blocks || [];

        if (!actionId || !userId || !channel || !ts) {
            return res.sendStatus(200);
        }

        // --- Suggest topics ---
        if (actionId === 'suggest_topics') {
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Suggestion requested.',
                blocks: replaceActionsWithNote(originalBlocks, '*Suggestion requested*')
            });

            const suggestions = await collectCommunityTopics(userId, 5);
            let text;
            if (suggestions.length > 0) {
                text = `Here are a few topics other colleagues are into:\n${bullets(suggestions)}\n\nIf you'd like to use any of these, just tell me.`;
            } else {
                const user = await getUser(userId);
                const country = user?.country || user?.Country || user?.location || 'your country';
                let cultural = [];
                try {
                    cultural = await culturalTopicSuggestions(country, 5);
                } catch (_) { cultural = []; }
                if (!Array.isArray(cultural) || cultural.length === 0) {
                    cultural = sample([
                        `${country} cuisine`, `${country} music`, `${country} festivals`,
                        `${country} football`, `${country} landmarks`, `${country} cinema`
                    ].map(s => s.toLowerCase()), 5);
                }
                text = `I don't have topics from other colleagues yet. Since you're in ${country}, here are a few cultural ideas you could discuss:\n${bullets(cultural)}\n\nIf you'd like to use any of these, just tell me.`;
            }

            await slackClient.chat.postMessage({ channel, text });
            return res.sendStatus(200);
        }

        // --- Confirm interests ---
        if (actionId === 'confirm_interests') {
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Interests confirmed.',
                blocks: replaceActionsWithNote(originalBlocks, '*Selection: Confirmed*')
            });

            const interests = pendingInterests.get(userId) || [];
            if (interests.length > 0) {
                try {
                    await saveResponse(userId, interests);
                } catch (e) {
                    console.error('Error saving interests:', e);
                }
            }
            pendingInterests.delete(userId);

            // Em vez de terminar aqui, vamos pedir a preferência de match
            await slackClient.chat.postMessage({
                channel,
                text: interests.length
                    ? `Perfect! I saved your interests: *${interests.join(', ')}*.`
                    : `All set.`
            });

            await askMatchPreference(userId); // define status awaiting_match_pref
            return res.sendStatus(200);
        }

        // --- Refine interests ---
        if (actionId === 'refine_interests') {
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Awaiting more details…',
                blocks: replaceActionsWithNote(originalBlocks, '*Selection: Provide more details*')
            });

            pendingInterests.delete(userId);
            await setUserStatus(userId, 'awaiting_interests_freeform');

            await slackClient.chat.postMessage({
                channel,
                text: 'Great — add a bit more detail about what you enjoy or want to learn, and I will propose an updated list.'
            });

            return res.sendStatus(200);
        }

        // --- Choose match preference: 1:1 ---
        if (actionId === 'choose_match_1_1') {
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Match preference selected.',
                blocks: replaceActionsWithNote(originalBlocks, '*Match preference: 1:1*')
            });

            await saveMatchPref(userId, '1:1');
            await setUserStatus(userId, 'active');

            await slackClient.chat.postMessage({
                channel,
                text: "Great — we’ll prioritise creating a 1:1 room when other colleagues also chose 1:1. If that’s not possible, you’ll be added to a group so " +
                    "you don’t miss out.\n\n See you there on Thursday! If you change your interests, just let me know."
            });

            return res.sendStatus(200);
        }

        // --- Choose match preference: Group ---
        if (actionId === 'choose_match_group') {
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Match preference selected.',
                blocks: replaceActionsWithNote(originalBlocks, '*Match preference: Group*')
            });

            await saveMatchPref(userId, 'group');
            await setUserStatus(userId, 'active');

            await slackClient.chat.postMessage({
                channel,
                text: "Got it — we’ll aim to place you into a group conversation. See you there on Thursday!\n\n If you change your interests, just let me know."
            });

            return res.sendStatus(200);
        }

        if (actionId === 'join_group') {
            const { channelId, topic } = JSON.parse(payload.actions[0].value);
            try {
                await slackClient.conversations.invite({ channel: channelId, users: userId });
                await slackClient.chat.postMessage({
                    channel: channelId,
                    text: `👋 <@${userId}> joined this *${topic}* group!`
                });
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `✅ You’ve been added to the *${topic}* group. Enjoy!`
                });
            } catch (err) {
                console.error("Error adding user to group:", err);
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: "⚠️ Sorry, something went wrong adding you to the group."
                });
            }
            return res.sendStatus(200);
        }

        if (actionId === 'confirm_exit_yes') {
            // esconde os botões na mensagem original
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Leaving weekly matches…',
                blocks: replaceActionsWithNote(originalBlocks, '*Leaving confirmed*')
            });

            try {
                const { hardDeleted } = await eraseUserData(userId);

                // Mensagem ao utilizador
                const farewell = hardDeleted
                    ? "✅ Your data has been deleted. We hope you had fun and met amazing colleagues!"
                    : "✅ You have been unsubscribed from weekly matches. We hope you had fun and met amazing colleagues!";
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: farewell
                });
            } catch (e) {
                console.error('Error deleting user data:', e);
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: "⚠️ Something went wrong while deleting your data. Please try again later."
                });
            }

            return res.sendStatus(200);
        }

// --- Confirm exit: NO ---
        if (actionId === 'confirm_exit_no') {
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Staying in weekly matches.',
                blocks: replaceActionsWithNote(originalBlocks, '*Stayed in matches*')
            });

            await slackClient.chat.postMessage({
                channel: userId,
                text: "Glad you reconsidered — we love having you here! 🎉"
            });

            return res.sendStatus(200);
        }

        // ... já tens parsing do payload / vars channel, ts, originalBlocks, userId, etc.

// 1) Check-in: connected? (Yes/No)
        if (actionId === 'checkin_connected_yes' || actionId === 'checkin_connected_no') {
            const yes = actionId === 'checkin_connected_yes';
            const week = weekKey();

            // Esconde botões
            await slackClient.chat.update({
                channel, ts,
                text: 'Check-in saved.',
                blocks: replaceActionsWithNote(originalBlocks, yes ? '*Check-in: Yes*' : '*Check-in: No*')
            });

            // Guarda resposta
            try { await upsertCheckinConnected(userId, week, yes); } catch (e) { console.error('save checkin connected failed:', e); }

            // Pergunta participação para a próxima ronda
            await slackClient.chat.postMessage({
                channel,
                text: "Got it! I'm preparing a new round of matches. Would you like to participate?",
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: "Got it! I'm preparing a new round of matches. Would you like to participate?" } },
                    {
                        type: 'actions',
                        elements: [
                            { type: 'button', text: { type: 'plain_text', text: 'Yes, count me in' }, style: 'primary', action_id: 'participate_yes' },
                            { type: 'button', text: { type: 'plain_text', text: 'No, not this week' }, action_id: 'participate_no' }
                        ]
                    }
                ]
            });

            return res.sendStatus(200);
        }

// 2) Participação: sim / não
        if (actionId === 'participate_yes' || actionId === 'participate_no') {
            const yes = actionId === 'participate_yes';
            const week = weekKey();

            await slackClient.chat.update({
                channel, ts,
                text: 'Preference saved.',
                blocks: replaceActionsWithNote(originalBlocks, yes ? '*Participation: Yes*' : '*Participation: No*')
            });

            try { await upsertCheckinParticipate(userId, week, yes); } catch (e) { console.error('save checkin participate failed:', e); }

            if (!yes) {
                await slackClient.chat.postMessage({
                    channel,
                    text: `No problem! I will check again next week. You can opt to quit the cycle by typing "exit" or "leave".`
                });
                // podes marcar status "paused" se quiseres:
                try { await setUserStatus(userId, 'paused'); } catch {}
                return res.sendStatus(200);
            }

            // Se sim: oferecer manter ou mudar preferências
            await slackClient.chat.postMessage({
                channel,
                text: `Great — you'll be included in the next round of matches. Matches happen on Thursday and I'll collect responses until then.\nWould you like to change your preferences?`,
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: `Great — you'll be included in the next round of matches. Matches happen on *Thursday* and I'll collect responses until then.\nWould you like to change your preferences (interests & match type)?` } },
                    {
                        type: 'actions',
                        elements: [
                            { type: 'button', text: { type: 'plain_text', text: 'Keep current settings' }, style: 'primary', action_id: 'keep_prefs' },
                            { type: 'button', text: { type: 'plain_text', text: 'Change preferences' }, action_id: 'change_prefs' }
                        ]
                    }
                ]
            });

            return res.sendStatus(200);
        }

// 3) Manter / Mudar preferências
        if (actionId === 'keep_prefs') {
            await slackClient.chat.update({
                channel, ts,
                text: 'Preferences kept.',
                blocks: replaceActionsWithNote(originalBlocks, '*Preferences: Keep current*')
            });

            try { await setUserStatus(userId, 'active'); } catch {}
            await slackClient.chat.postMessage({
                channel,
                text: "Perfect — you're all set for the next round. Ping me anytime if you want to update your interests."
            });
            return res.sendStatus(200);
        }

        if (actionId === 'change_prefs') {
            await slackClient.chat.update({
                channel, ts,
                text: 'Let’s update your preferences…',
                blocks: replaceActionsWithNote(originalBlocks, '*Preferences: Change*')
            });

            try { await setUserStatus(userId, 'awaiting_interests_freeform'); } catch {}

            await slackClient.chat.postMessage({
                channel,
                text: "Tell me a bit about what you'd like to discuss or learn, and I'll propose an updated list.",
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: "Tell me a bit about what you'd like to discuss or learn, and I'll propose an updated list." } },
                    suggestTopicsButton()
                ]
            });

            return res.sendStatus(200);
        }



        return handleSlackActions(req, res);
    } catch (e) {
        console.error('Error in /slack/actions:', e.message);
        return res.sendStatus(200);
    }
});

// ---------- Debug ----------
app.get('/debug/responses', async (req, res) => {
    try {
        const responses = await getAllResponses();
        res.json(responses);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/debug/clear', async (req, res) => {
    try {
        await clearResponses();
        res.send('Responses cleared');
        await clearUsers();
        res.send('Users cleared');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/debug/users', async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json(users);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/debug/match', async (req, res) => {
    try {
        const token = req.query.token;
        const today = new Date().getUTCDay(); // 0=Domingo ... 5=Sexta

        // Se tem token (vem do Scheduler) → só corre às quintas
        if (token) {
            if (today !== 4) {
                return res.json({ skipped: true, reason: 'Not thursday' });
            }
        }

        // Aqui corre sempre (se foi manual, ou se for sexta com token)
        const result = await runMatcher();
        const { created = [], unmatched = [], notEnough = false } = result || {};

        const groupRooms = created
            .filter(c => c.type === 'group')
            .map(c => ({ topic: c.topic, channelId: c.channelId }));

        for (const uid of unmatched) {
            await sendNoMatchOptions(uid, groupRooms);
        }

        res.json({ created, unmatched });
    } catch (err) {
        console.error('Error running matcher:', err);
        res.status(500).send(err.message);
    }
});

// Arquiva salas + dispara DMs de check-in
app.get('/debug/weekly-checkin', async (req, res) => {
    try {
        const token = req.query.token;
        const today = new Date().getUTCDay(); // 0=Domingo ... 5=Sexta

        // Se tem token (vem do Scheduler) → só corre às tercas
        if (token) {
            if (today !== 2) {
                return res.json({ skipped: true, reason: 'Not Tuesday' });
            }
        }

        const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
        const bodyChannels = Array.isArray(req.body?.channel_ids) ? req.body.channel_ids : null;

        // se vierem canais no payload, regista-os (e usa-os)
        if (bodyChannels) {
            for (const ch of bodyChannels) { if (ch) await upsertMatchRoom(ch); }
        }

        const channelIds = bodyChannels || await getActiveRooms();
        const week = weekKey();
        let archived = 0, dms = 0;

        // id do bot para filtrar se necessário
        let botUserId = null;
        try { const auth = await slack.auth.test(); botUserId = auth?.user_id || null; } catch {}

        for (const channel of channelIds) {
            if (!channel) continue;

            // Mensagem de despedida
            try {
                await slack.chat.postMessage({
                    channel,
                    text: "Hope you had fun and made some new connections. This channel will be archived now. See you again soon!"
                });
            } catch (e) {
                console.warn('post farewell failed for', channel, e.data?.error || e.message);
            }

            // Recolher participantes e DM check-in
            let members = [];
            try {
                const r = await slack.conversations.members({ channel });
                members = Array.isArray(r?.members) ? r.members : [];
            } catch (e) {
                console.warn('members fetch failed for', channel, e.data?.error || e.message);
            }

            for (const uid of members) {
                if (!uid) continue;
                if (botUserId && uid === botUserId) continue; // ignora o bot
                try {
                    const u = await getUser(uid); // pode não existir no teu DB, é ok
                    await askWeeklyCheckin(slack, uid, u?.name);
                    dms++;
                } catch (e) {
                    console.warn('check-in DM failed for', uid, e.message);
                }
            }

            // Arquivar canal (só funciona para canais, não DMs/MPIM)
            try {
                await slack.conversations.archive({ channel });
                await markRoomArchived(channel);
                archived++;
            } catch (e) {
                console.warn('archive failed for', channel, e.data?.error || e.message);
                // se não der para arquivar (ex.: DM), marca como arquivado mesmo assim?
                // await markRoomArchived(channel);
            }
        }

        res.json({ ok: true, archived, checkinDMs: dms, week });
    } catch (e) {
        console.error('/cron/weekly-checkin error:', e);
        res.status(500).send(e.message);
    }
});

/** Apaga (ou desativa) dados do utilizador, preferindo hard-delete */
async function eraseUserData(userId) {
    // 1) tenta hard-delete total (transação)
    try {
        await deleteUserCascade(userId);
        return { hardDeleted: true };
    } catch (e) {
        console.warn('deleteUserCascade failed, falling back to softer path:', e.message);
    }

    // 2) fallback: tentar apagar respostas e o próprio user separadamente
    try { await deleteResponsesByUser(userId); } catch (_) {}
    try {
        await deleteUser(userId);
        return { hardDeleted: true };
    } catch (e) {
        console.warn('deleteUser failed, will soft opt-out:', e.message);
    }

    // 3) soft delete por fim (mantém a linha em users mas fora do sistema)
    try { await softOptOutUser(userId); } catch (_) {}
    return { hardDeleted: false };
}

/** Envia prompt de confirmação para sair */
async function askExitConfirmation(userId) {
    const blocks = [
        {
            type: 'section',
            text: { type: 'mrkdwn',
                text: "*Do you want to leave weekly matches?*\nIf you confirm, your data will be deleted."
            }
        },
        {
            type: 'actions',
            elements: [
                { type: 'button', text: { type: 'plain_text', text: 'Yes, leave & delete' }, style: 'danger', action_id: 'confirm_exit_yes' },
                { type: 'button', text: { type: 'plain_text', text: "No, I'll stay" }, action_id: 'confirm_exit_no' }
            ]
        }
    ];
    await slackClient.chat.postMessage({
        channel: userId,
        text: 'Confirm leaving weekly matches?',
        blocks
    });
}

/** Nota utilitária para substituir botões por texto informativo */
function replaceActionsWithNote(blocks, note) {
    const safe = Array.isArray(blocks) ? blocks : [];
    return safe.map(b => b.type === 'actions'
        ? { type: 'context', elements: [{ type: 'mrkdwn', text: note }] }
        : b
    );
}

module.exports = app;
