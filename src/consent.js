// src/consentimento.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const slackClient = require('./slackClient');
const { saveUser } = require('./db');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// === HELPER TO FETCH USER NAME FROM SLACK ===
async function getUserName(userId) {
    try {
        const res = await slackClient.users.info({ user: userId });
        if (res.ok && res.user && res.user.profile) {
            return res.user.profile.real_name || res.user.name || userId;
        }
        return userId;
    } catch (err) {
        console.error("Error fetching Slack username:", err.message);
        return userId;
    }
}

// === SLACK ACTIONS ENDPOINT (BUTTONS) ===
app.post('/slack/actions', async (req, res) => {
    const payload = JSON.parse(req.body.payload);
    const userId = payload.user.id;

    if (payload.type === 'block_actions') {
        const action = payload.actions[0];
        const name = await getUserName(userId);

        if (action.action_id === 'consent_yes') {
            await saveUser(userId, name, true, 'awaiting_country');
            await slackClient.chat.postMessage({
                channel: userId,
                text: `🚀 Great, ${name}! In which country do you live?`
            });
        }

        if (action.action_id === 'consent_no') {
            await saveUser(userId, name, false, 'inactive');
            await slackClient.chat.postMessage({
                channel: userId,
                text: `👍 No problem, ${name}! If you change your mind, just send me a message anytime.`
            });
        }
    }

    res.status(200).send();
});

// === INITIAL CONSENT MESSAGE ===
async function sendConsentMessage(userId) {
    const userName = await getUserName(userId);

    const message = {
        channel: userId,
        text: `Hello ${userName} 👋 Do you want to participate in Micro-Match this week?`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `👋 Hello *${userName}*! Welcome to *Micro-Match Bot*. This bot helps you meet colleagues with shared interests.\n\nDo you want to join this experience?`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Yes 🚀" },
                        style: "primary",
                        value: "consent_yes",
                        action_id: "consent_yes"
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "No ❌" },
                        style: "danger",
                        value: "consent_no",
                        action_id: "consent_no"
                    }
                ]
            }
        ]
    };

    await slackClient.chat.postMessage(message);
}

module.exports = { app, sendConsentMessage };