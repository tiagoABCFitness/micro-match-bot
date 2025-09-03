// src/matcher.js
require('dotenv').config();
const { getAllResponses } = require('./db');
const slackClient = require('./slackClient');

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

  const matches = [];
  const used = new Set();

  // Find exact topic matches
  for (let i = 0; i < responses.length; i++) {
    if (used.has(responses[i].userId)) continue;

    for (let j = i + 1; j < responses.length; j++) {
      if (used.has(responses[j].userId)) continue;

      // check if they share at least one topic
      const common = responses[i].topics.filter(t => responses[j].topics.includes(t));
      if (common.length > 0) {
        matches.push({
          users: [responses[i].userId, responses[j].userId],
          commonTopics: common
        });
        used.add(responses[i].userId);
        used.add(responses[j].userId);
        break;
      }
    }
  }

  console.log('Matches found:', matches);

  // Create Slack channels
  const today = new Date().toISOString().slice(0,10).replace(/-/g,''); // YYYYMMDD
  for (const match of matches) {
    const mainTopic = match.commonTopics[0].toLowerCase().replace(/\s+/g,''); // remove spaces
    const channelName = `micromatch-${mainTopic}-${today}`;

    try {
      const channelRes = await slackClient.conversations.create({
        name: channelName,
        is_private: true
      });

      await slackClient.conversations.invite({
        channel: channelRes.channel.id,
        users: match.users.join(',')
      });

      await slackClient.chat.postMessage({
        channel: channelRes.channel.id,
        text: `🎉 You’ve been matched! Common topics: ${match.commonTopics.join(', ')}.\nHere’s a conversation starter: *What’s something new you learned about these topics recently?*`
      });

      console.log(`Channel created: ${channelName}`);
    } catch (err) {
      console.error('Error creating Slack channel:', err.message);
    }
  }
}

// Run if called directly
if (require.main === module) {
  runMatcher();
}

module.exports = { runMatcher };
