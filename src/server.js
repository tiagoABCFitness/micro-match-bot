// src/server.js
require('dotenv').config();
const express = require('express');
const app = express();

const { saveResponse, getAllResponses, clearResponses, getUser, saveUser } = require('./db');
const { sendConsentMessage, handleSlackActions, getUserName } = require('./consent');
const slackClient = require('./slackClient');

// Slack events usam JSON
app.use(express.json());
// Slack interactivity usa application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// --- Slack Events (DMs ao bot)
app.post('/slack/events', async (req, res) => {
    const { type, challenge, event } = req.body;

    if (type === 'url_verification') {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(challenge);
    }

    if (event && event.type === 'message' && event.channel_type === 'im' && !event.bot_id) {
        const userId = event.user;

        try {
            let user = await getUser(userId);

            if (!user) {
                // Novo user → dispara consentimento e regista estado inicial
                const userName = await getUserName(userId);
                await sendConsentMessage(userId);
                await saveUser(userId, userName, 0, 'awaiting_consent');
                console.log(`New user ${userName} (${userId}) triggered consent flow.`);
                return res.status(200).send();
            }

            if (!user.consent) {
                console.log(`User ${userId} has not given consent. Ignoring message.`);
                return res.status(200).send();
            }

            // Fluxo normal (como antes): guardar interesses
            console.log(`Received message from ${event.user}: ${event.text}`);

            const topics = event.text
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0);

            await saveResponse(event.user, topics);
            console.log(`Saved response for ${event.user}:`, topics);
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

module.exports = app;
