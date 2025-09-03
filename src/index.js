require('dotenv').config();
const { sendMessageToUsers } = require('./messageHandler');
const app = require('./server');
const { runMatcher } = require('./matcher');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Detect day of week (UTC)
const today = new Date().getUTCDay(); // 0=Sunday, 1=Monday, ..., 5=Friday

(async () => {
  try {
    if (today === 1) { // Monday → send initial messages
      const message = `Hi there! What are your interests today? Reply with one or more categories separated by commas (e.g., fitness, cinema, games).`;
      await sendMessageToUsers(message);
      console.log('Initial message sent to all users!');
    }

    if (today === 5) { // Friday → run matcher
      await runMatcher();
      console.log('Matcher executed successfully!');
    }
  } catch (err) {
    console.error('Error during scheduled task:', err.message);
  }
})();
