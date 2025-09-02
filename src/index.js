const { sendMessageToUsers } = require('./messageHandler');

(async () => {
  try {
    const message = `Hi there! What are your interests today? Reply with one or more categories: "movies", "games", "fitness".`;
    await sendMessageToUsers(message);
    console.log('Message sent successfully!');
  } catch (error) {
    console.error('Error sending message:', error.message);
    process.exit(1);
  }
})();
