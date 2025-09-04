// src/server.js
require('dotenv').config();
const { countryFunFact } = require('./ai.js');
const { WebClient } = require('@slack/web-api');
const express = require('express');
const app = express();
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

// Slack Events usam JSON; Slack Interactivity usa x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Slack Events (DMs ao bot)
app.post('/slack/events', async (req, res) => {
    const { type, challenge, event } = req.body;

    // Slack URL verification
    if (type === 'url_verification') {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(challenge);
    }

    // Apenas mensagens por DM e não enviadas por bot
    if (event && event.type === 'message' && event.channel_type === 'im' && !event.bot_id) {
        const userId = event.user;

        try {
            let user = await getUser(userId);

            // 1) Novo utilizador → iniciar consentimento
            if (!user) {
                const userName = await getUserName(userId);
                await sendConsentMessage(userId);
                await saveUser(userId, userName, 0, 'awaiting_consent');
                console.log(`New user ${userName} (${userId}) triggered consent flow.`);
                return res.status(200).send();
            }

            // 2) Utilizador sem consentimento → pedir novamente (re-consent)
            if (!user.consent) {
                await sendConsentMessage(userId, { revisit: true });
                await setUserStatus(userId, 'awaiting_consent');
                console.log(`User ${user.name || userId} (${userId}) asked to re-consent.`);
                return res.status(200).send();
            }

            // 3) À espera do país → NÃO guardar como interesse
            if (user.status === 'awaiting_country') {
                const country = (event.text || '').trim();
                if (!country) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: 'Please tell me your country (e.g., Portugal).'
                    });
                    return res.status(200).send();
                }

                await updateUserCountry(userId, country);
                await setUserStatus(userId, 'awaiting_interests');

                const funFact = await countryFunFact(country).catch(() => null);

                const baseText = `Great — noted **${country}**.`;
                const factText = funFact ? `\nDid you knew that: ${funFact}` : '';
                const text = `${baseText}${factText}`;

                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `*${text}*. Now, what are your interests?\nReply with a few topics separated by commas (e.g., fitness, cinema, games).`
                });
                return res.status(200).send();
            }

            // 4) À espera dos interesses → agora sim guardar em responses
            if (user.status === 'awaiting_interests') {
                const topics = (event.text || '')
                    .split(',')
                    .map(t => t.trim().toLowerCase())
                    .filter(Boolean);

                if (topics.length === 0) {
                    await slackClient.chat.postMessage({
                        channel: userId,
                        text: 'Please send at least one interest (comma-separated). For example: fitness, cinema, games'
                    });
                    return res.status(200).send();
                }

                await saveResponse(userId, topics);
                await setUserStatus(userId, 'active');

                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `Perfect! I saved your interests: *${topics.join(', ')}*.\nI'll try to match you on Friday.`
                });
                return res.status(200).send();
            }

            // 5) Utilizador ativo → comportamento antigo (atualiza interesses)
            console.log(`Received message from ${userId}: ${event.text}`);
            const topics = (event.text || '')
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(Boolean);

            if (topics.length > 0) {
                await saveResponse(userId, topics);
                console.log(`Saved interests for ${userId}:`, topics);
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `Updated your interests to: *${topics.join(', ')}*.`
                });
            } else {
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: 'Send interests separated by commas (e.g., fitness, cinema, games).'
                });
            }
        } catch (err) {
            console.error('Error in /slack/events:', err.message);
        }
    }

    return res.status(200).send();
});

// --- Slack Interactivity (botões)
app.post('/slack/actions', handleSlackActions);

// --- Debug
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
