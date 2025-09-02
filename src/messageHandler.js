const slackClient = require('./slackClient');
const fs = require('fs');

async function sendMessageToUsers(text) {
  const users = JSON.parse(fs.readFileSync('./data/users.json'));

  for (const userId of users) {
    await slackClient.chat.postMessage({
      channel: userId,
      text,
    });
  }
}

module.exports = { sendMessageToUsers };
