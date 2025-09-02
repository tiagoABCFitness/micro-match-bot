const cron = require('node-cron');
const { sendMessageToUsers } = require('./messageHandler');

function scheduleMessage() {
  
(async () => {
  const message = `Hi! What are your interests for this week?".`;
  await sendMessageToUsers(message);
  console.log('Message sent!');
})();

}

module.exports = { scheduleMessage };
