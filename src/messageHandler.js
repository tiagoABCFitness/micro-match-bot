const slackClient = require('./slackClient');
const fs = require('fs');

async function sendMessageToUsers(text) {
  const users = JSON.parse(fs.readFileSync('./data/users.json'));

  for (const userId of users) {
    try {
      const res = await slackClient.chat.postMessage({
        channel: userId,
        text,
      });
      console.log(`Message sent to ${userId}:`, res.ok);
    } catch (error) {
      console.error(`Error sending to ${userId}:`, error.message);
    }
  }
}

module.exports = { sendMessageToUsers };
