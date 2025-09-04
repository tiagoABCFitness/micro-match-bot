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

module.exports = { sendMessageToUsers };
