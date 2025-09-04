// server.js
require('dotenv').config();
const express = require('express');
const app = express();

const { saveResponse, getAllResponses, clearResponses, getUser, saveUser } = require('./db');
const { sendConsentMessage, getUserName  } = require('./consent');
const slackClient = require('./slackClient');

app.use(express.json());

// === SLACK EVENTS ===
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
                // New user → trigger consent
                const userName = await getUserName(userId);
                await sendConsentMessage(userId);
                await saveUser(userId, userName, 0, 'awaiting_consent');
                console.log(`New user ${userId} triggered consent flow.`);
                return res.status(200).send();
            }

            if (!user.consent) {
                console.log(`User ${userId} has not given consent. Ignoring message.`);
                return res.status(200).send();
            }

            // Process user response normally
            console.log(`Received message from ${event.user}: ${event.text}`);

            const topics = event.text
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0);

            await saveResponse(event.user, topics);
            console.log(`Saved response for ${event.user}:`, topics);

        } catch (err) {
            console.error("Error in /slack/events:", err.message);
        }
    }

    res.status(200).send();
});

// === DEBUG ROUTES ===
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
        res.send("Responses cleared");
    } catch (err) {
        res.status(500).send(err.message);
    }
});

module.exports = app;
