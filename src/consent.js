// src/consent.js
require('dotenv').config();
const slackClient = require('./slackClient');
const { saveUser } = require('./db');

// --- Helper: obter o nome do Slack com fallback decente
async function getUserName(userId) {
    try {
        const res = await slackClient.users.info({ user: userId });
        if (res.ok && res.user) {
            const p = res.user.profile || {};
            return p.display_name || p.real_name || res.user.real_name || res.user.name || userId;
        }
        return userId;
    } catch (err) {
        console.error('Error fetching Slack username:', err.message);
        return userId;
    }
}

// --- Mensagem inicial de consentimento
async function sendConsentMessage(userId, { revisit = false } = {}) {
    const userName = await getUserName(userId);

    const headline = revisit
        ? `👋 Welcome back, *${userName}*!`
        : `👋 Hello *${userName}*!`;

    const body = revisit
        ? `Glad to see you again. Do you want to try *Micro-Match* now?`
        : `Welcome to *Micro-Match Bot*. This bot helps you meet colleagues with shared interests.\n\nDo you want to join this experience?`;

    const message = {
        channel: userId,
        text: `Hello ${userName} 👋 Do you want to participate in Micro-Match${revisit ? ' now' : ' this week'}?`,
        blocks: [
            {
                type: 'section',
                text: { type: 'mrkdwn', text: `${headline}\n\n${body}` }
            },
            {
                type: 'actions',
                elements: [
                    {
                        type: 'button',
                        text: { type: 'plain_text', text: 'Yes 🚀' },
                        style: 'primary',
                        value: 'consent_yes',
                        action_id: 'consent_yes'
                    },
                    {
                        type: 'button',
                        text: { type: 'plain_text', text: 'No ❌' },
                        style: 'danger',
                        value: 'consent_no',
                        action_id: 'consent_no'
                    }
                ]
            }
        ]
    };

    await slackClient.chat.postMessage(message);
}

async function sendReconsentMessage(userId) {
    return sendConsentMessage(userId, { revisit: true });
}

// --- Handler do endpoint /slack/actions (botões)
async function handleSlackActions(req, res) {
    try {
        // Slack envia application/x-www-form-urlencoded → payload vem como string
        const payload = JSON.parse(req.body.payload);
        const userId = payload.user.id;

        if (payload.type === 'block_actions') {
            const action = payload.actions?.[0];
            const name = await getUserName(userId);

            if (action?.action_id === 'consent_yes') {
                await saveUser(userId, name, true, 'awaiting_country');
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `🚀 Great, ${name}! In which country do you live?`
                });
            }

            if (action?.action_id === 'consent_no') {
                await saveUser(userId, name, false, 'inactive');
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: `👍 No problem, ${name}! If you change your mind, just send me a message anytime.`
                });
            }
        }

        // Responder 200 rapidamente para o Slack não repetir a entrega
        return res.status(200).send();
    } catch (err) {
        console.error('Error in /slack/actions handler:', err.message);
        return res.status(200).send(); // ainda assim 200 p/ Slack
    }
}

module.exports = { sendConsentMessage, sendReconsentMessage, getUserName, handleSlackActions };
