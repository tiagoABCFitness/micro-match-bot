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
        ? `👋 Welcome back, *${userName}*`
        : `👋 Hi *${userName}*, I’m Micro-Match!`;

    const body = `\nTo get started, I need your consent to record your answers for matchmaking only. Data is stored securely and never shared. Is that okay?`;

    const message = {
        channel: userId,
        text: `Hi ${userName} 👋 Do you want to participate in Micro-Match${revisit ? ' now' : ' this week'}?`,
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
                        text: { type: 'plain_text', text: 'Yes, continue. 🚀' },
                        style: 'primary',
                        value: 'consent_yes',
                        action_id: 'consent_yes'
                    },
                    {
                        type: 'button',
                        text: { type: 'plain_text', text: 'No, thanks. ❌' },
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
        const payload = JSON.parse(req.body.payload);
        const userId = payload.user.id;
        const action = payload.actions?.[0];

        // Estes dois campos identificam a mensagem original com botões
        const channelId = payload.container?.channel_id || payload.channel?.id;
        const messageTs = payload.container?.message_ts || payload.message?.ts;

        const name = await getUserName(userId);

        if (action?.action_id === 'consent_yes') {
            // 1) Atualiza DB / fluxo
            await saveUser(userId, name, true, 'awaiting_country');

            // 2) **ATUALIZA A MENSAGEM ORIGINAL** → remove botões
            await slackClient.chat.update({
                channel: channelId,
                ts: messageTs,
                text: `✅ Choice recorded`,
                blocks: [
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `✅ Thanks, *${name}*! Your consent was recorded.` }
                    },
                    {
                        type: 'context',
                        elements: [
                            { type: 'mrkdwn', text: 'You can clear your data anytime by typing exit or leave.' }
                        ]
                    }
                ]
            });

            // 3) Envia a próxima mensagem do fluxo
            await slackClient.chat.postMessage({
                channel: userId,
                text: `🚀 Great, ${name}! First things first, where do you currently live (Country)?`
            });
        }

        if (action?.action_id === 'consent_no') {
            await saveUser(userId, name, false, 'inactive');

            // **ATUALIZA A MENSAGEM ORIGINAL** → remove botões
            await slackClient.chat.update({
                channel: channelId,
                ts: messageTs,
                text: `❌ Choice recorded`,
                blocks: [
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `❌ No worries, *${name}*.` }
                    },
                    {
                        type: 'context',
                        elements: [
                            { type: 'mrkdwn', text: 'If you change your mind, just send me a hi!' }
                        ]
                    }
                ]
            });

            await slackClient.chat.postMessage({
                channel: userId,
                text: `👍 No problem, ${name}! If you change your mind, just send me a message.`
            });
        }

        return res.status(200).send();
    } catch (err) {
        console.error('Error in /slack/actions handler:', err.message);
        return res.status(200).send();
    }
}

module.exports = { sendConsentMessage, sendReconsentMessage, getUserName, handleSlackActions };
