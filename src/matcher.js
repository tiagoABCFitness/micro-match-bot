// src/matcher.js
require('dotenv').config();
const { getAllResponses } = require('./db');
const slackClient = require('./slackClient');

function sanitizeChannelName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);
}

// Main matcher function using exact topic matching
async function runMatcher() {
  const responses = await getAllResponses();

  /*for manual testing
  * comment line above
  * uncomment line below
  * access https://micro-match-bot-d6dc1712503c.herokuapp.com/debug/responses
  * copy the vector and paste */

  //const responses = PASTE_YOUR_VECTOR_HERE;

  if (responses.length < 1) {
    console.log("Not enough users to match.");
    return;
  }


    // Agrupar utilizadores por tópico
    const topicGroups = {};
    for (const { userId, topics } of responses) {
        for (const topic of topics) {
            if (!topicGroups[topic]) topicGroups[topic] = new Set();
            topicGroups[topic].add(userId);
        }
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    for (const [topic, userSet] of Object.entries(topicGroups)) {
        const users = Array.from(userSet);
        if (users.length >= minGroupSize) {
            const rawChannelName = `micromatch-${topic}-${today}`;
            const channelName = sanitizeChannelName(rawChannelName);

            try {
                const channelRes = await slackClient.conversations.create({
                    name: channelName,
                    is_private: true
                });

                await slackClient.conversations.invite({
                    channel: channelRes.channel.id,
                    users: users.join(',')
                });

                await slackClient.chat.postMessage({
                    channel: channelRes.channel.id,
                    text: `🎉 You’ve been matched on *${topic}*! There are ${users.length} of you here.\nHere’s a conversation starter: *What’s something new you learned about ${topic} recently?*`
                });

                console.log(`Channel created: ${channelName} with ${users.length} users`);
            } catch (err) {
                console.error(`Error creating channel for topic "${topic}":`, err.message);
            }
        }
    }
}

// Run if called directly
if (require.main === module) {
    runMatcher();
}

module.exports = { runMatcher };
