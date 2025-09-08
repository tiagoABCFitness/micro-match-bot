// src/messageHandler.js
const slackClient = require('./slackClient');
const { getUser } = require('./db');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB setup
const dbPath = path.join(__dirname, '..', 'data', 'responses.db');
const db = new sqlite3.Database(dbPath);

function getAllConsentingUsers() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT user_id FROM users WHERE consent = 1`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.user_id));
        });
    });
}

async function sendMessageToUsers(message) {
    const users = await getAllConsentingUsers();

    for (const userId of users) {
        try {
            const payload = {
                channel: userId,
                text: typeof message === 'string' ? message : message.text,
            };

            if (typeof message === 'object' && message.blocks) {
                payload.blocks = message.blocks;
            }

            const res = await slackClient.chat.postMessage(payload);
            console.log(`Message sent to ${userId}:`, res.ok);
        } catch (error) {
            console.error(`Error sending to ${userId}:`, error.message);
        }
    }
}

async function sendNoMatchOptions(userId, groupRooms) {
    const rooms = Array.isArray(groupRooms) ? groupRooms : [];

    // Sem salas → mensagem simples
    if (!rooms.length) {
        await slackClient.chat.postMessage({
            channel: userId,
            text: "😔 I couldn’t find a match for you this round, but no worries! A new round starts next week, and I’d love to try again."
        });
        return;
    }

    // Deduplicar por channelId+topic e limpar dados
    const seen = new Set();
    const uniqueRooms = [];
    for (const r of rooms) {
        const channelId = r?.channelId;
        const topic = String(r?.topic ?? '').trim();
        if (!channelId || !topic) continue;
        const key = `${channelId}:${topic.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueRooms.push({ channelId, topic });
    }

    if (!uniqueRooms.length) {
        await slackClient.chat.postMessage({
            channel: userId,
            text: "😔 I couldn’t find group rooms to suggest right now. I’ll try again next week!"
        });
        return;
    }

    // Criar botões de salas (texto máx. ~75 chars para Slack)
    const roomButtons = uniqueRooms.map(room => ({
        type: "button",
        text: { type: "plain_text", text: room.topic.slice(0, 75) },
        value: JSON.stringify({ action: "join_group", channelId: room.channelId, topic: room.topic }),
        action_id: "join_group"
    }));

    // Helper para chunk de arrays
    const chunk = (arr, size) => {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    };

    const blocks = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: "😔 This time we couldn't match you automatically.\nWould you like to join one of these group rooms instead?"
            }
        }
    ];

    // Se ≤4 salas, mete-as num só bloco + “No, thanks” (máx. 5 botões)
    if (roomButtons.length <= 4) {
        blocks.push({
            type: "actions",
            elements: [
                ...roomButtons,
                {
                    type: "button",
                    text: { type: "plain_text", text: "No, thanks" },
                    value: JSON.stringify({ action: "join_group_rejected" }),
                    action_id: "join_group_rejected"
                }
            ]
        });
    } else {
        // Se >3, divide em blocos de 5 (só salas),
        // e adiciona um bloco final apenas com “No, thanks”
        const chunks = chunk(roomButtons, 3);
        for (const part of chunks) {
            blocks.push({ type: "actions", elements: part });
        }
        blocks.push({
            type: "actions",
            elements: [{
                type: "button",
                text: { type: "plain_text", text: "No, thanks" },
                value: JSON.stringify({ action: "join_group_rejected" }),
                action_id: "join_group_rejected"
            }]
        });
    }

    await slackClient.chat.postMessage({
        channel: userId,
        text: "Choose a group to join",
        blocks
    });
}


module.exports = { sendMessageToUsers, sendNoMatchOptions };
