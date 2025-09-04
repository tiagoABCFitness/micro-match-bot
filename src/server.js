// src/server.js
require('dotenv').config();

const express = require('express');
const { WebClient } = require('@slack/web-api');
const app = express();

const { countryFunFact, analyzeInterests } = require('./ai.js');
const {
    saveResponse,
    getAllResponses,
    clearResponses,
    getUser,
    saveUser,
    setUserStatus,
    updateUserCountry,
    getAllUsers
} = require('./db');

const { sendConsentMessage, handleSlackActions, getUserName } = require('./consent');
const slackClient = require('./slackClient');

// ---------- Simple in-memory state ----------
/** Pending interests waiting for user confirmation. userId -> string[] */
const pendingInterests = new Map();

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
                        { type: 'context', elements: [{ type: 'mrkdwn', text: '_e.g., running, photography, programming, nutrition, English, investing…_' }] }
                    ]
                });

                return res.status(200).send();
            }

            // 4) Waiting for interests (freeform) OR user added more detail after we suggested bullets
            if (user.status === 'awaiting_interests_freeform' || pendingInterests.has(userId)) {
                if (!userText) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: 'Please share a few lines about what you enjoy or want to learn.'
                    });
                    return res.status(200).send();
                }

                const analysis = await analyzeInterests(userText).catch(() => ({ reply: '', interests: [] }));
                const interests = Array.isArray(analysis.interests) ? analysis.interests : [];

                if (interests.length === 0) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: "I didn't pick up enough interests. Could you add a bit more detail?"
                    });
                    // keep status as awaiting_interests_freeform
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
                                { type: 'button', text: { type: 'plain_text', text: 'Give more details' }, action_id: 'refine_interests' }
                            ]
                        }
                    ]
                });

                return res.status(200).send();
            }

            // 5) Active user — propose updates from free text (no more comma parsing)
            if (userText) {
                const analysis = await analyzeInterests(userText).catch(() => ({ reply: '', interests: [] }));
                const interests = Array.isArray(analysis.interests) ? analysis.interests : [];

                if (interests.length === 0) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: "Hey again — I've got your interests for this week. If you'd like to change them, tell me a bit about what you'd like to discuss or learn; otherwise you're all set and I'll work on finding you a match."
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

            // If we get here, there was no text to process
            await slackClient.chat.postMessage({
                channel: userId,
                text: 'Please send a short message about your interests.'
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
            // Fallback to original handler if any
            return handleSlackActions(req, res);
        }

        const payload = JSON.parse(payloadStr);
        if (payload?.type !== 'block_actions') {
            // Delegate anything we don't explicitly handle
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

        if (actionId === 'confirm_interests') {
            // 1) Hide buttons on the original message
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Interests confirmed.',
                blocks: replaceActionsWithNote(originalBlocks, '*Selection: Confirmed*')
            });

            // 2) Save and confirm
            const interests = pendingInterests.get(userId) || [];
            if (interests.length > 0) {
                try {
                    await saveResponse(userId, interests);
                    await setUserStatus(userId, 'active');
                } catch (e) {
                    console.error('Error saving interests:', e);
                }
            }
            pendingInterests.delete(userId);

            await slackClient.chat.postMessage({
                channel,
                text: interests.length
                    ? `Perfect! I saved your interests: *${interests.join(', ')}*.\nI'll try to match you on Friday.`
                    : `All set. You can message me any time to update your interests.`
            });

            return res.sendStatus(200);
        }

        if (actionId === 'refine_interests') {
            // 1) Hide buttons on the original message
            await slackClient.chat.update({
                channel,
                ts,
                text: 'Awaiting more details…',
                blocks: replaceActionsWithNote(originalBlocks, '*Selection: Provide more details*')
            });

            // 2) Ask for more info and keep phase
            pendingInterests.delete(userId);
            await setUserStatus(userId, 'awaiting_interests_freeform');

            await slackClient.chat.postMessage({
                channel,
                text: 'Great — add a bit more detail about what you enjoy or want to learn, and I will propose an updated list.'
            });

            return res.sendStatus(200);
        }

        // Any other action -> delegate to original handler (consent, etc.)
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

module.exports = app;
