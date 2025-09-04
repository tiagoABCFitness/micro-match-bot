// server.js
require('dotenv').config();
const express = require('express');
const app = express();

const { saveResponse, getAllResponses, clearResponses, getUser, saveUser } = require('./db');
const { sendConsentMessage } = require('./consent');
const slackClient = require('./slackClient');

app.use(express.json());

app.post('/slack/events', async (req, res) => {
    const { type, challenge, event } = req.body;

    if (type === 'url_verification') {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(challenge);
    }

    if (event && event.type === 'message' && event.channel_type === 'im' && !event.bot_id) {
        const userId = event.user;

        // 1) Check if user exists in DB
        let user = await getUser(userId);

        if (!user) {
            // New user → trigger consent flow
            await sendConsentMessage(userId);
            // Save user with status "awaiting_consent" (no consent yet)
            const userName = event.user; // aqui podes usar getUserName também
            await saveUser(userId, userName, 0, 'awaiting_consent');
            return res.status(200).send();
        }

        // 2) If user exists but has no consent → ignore message
        if (!user.consent) {
            console.log(`User ${userId} has not given consent, ignoring message.`);
            return res.status(200).send();
        }

        // 3) If user has consent → process normally (topics, etc.)
        console.log(`Received message from ${event.user}: ${event.text}`);
        const topics = event.text
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0);

        try {
            await saveResponse(event.user, topics);
            console.log(`Saved response for ${event.user}:`, topics);
        } catch (err) {
            console.error('DB error:', err.message);
        }
    }

    res.status(200).send();
});
