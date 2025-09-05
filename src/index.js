// index.js
require('dotenv').config();
const { sendMessageToUsers, sendNoMatchOptions } = require('./messageHandler');
const app = require('./server');
const { runMatcher } = require('./matcher');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Função para envio de mensagens (segunda-feira)
async function sendInterestMessages() {
  const message = `Hi there! What are your interests today? Reply with one or more categories separated by commas (e.g., fitness, cinema, games).`;
  await sendMessageToUsers(message);
  console.log('Initial message sent to all users!');
}

// Função para matcher (sexta-feira)
async function executeMatcher() {
    try {
        const { created, unmatched } = await runMatcher();

        const groupRooms = created
            .filter(c => c.type === 'group')
            .map(c => ({ topic: c.topic, channelId: c.channelId }));

        for (const uid of unmatched) {
            await sendNoMatchOptions(uid, groupRooms);
        }

        // Return the result instead of sending a response
        return { created, unmatched };
    } catch (err) {
        console.error('Error running matcher:', err);
        // Optionally rethrow or return error info
        throw err;
    }
}

// Execução automática via cron
(async () => {
  try {
    const today = new Date().getUTCDay(); // 0=Sunday, 1=Monday, ..., 5=Friday

    if (today === 1) await sendInterestMessages();
    if (today === 5) await executeMatcher();
  } catch (err) {
    console.error('Error during scheduled task:', err.message);
  }
})();

// Exporta funções para testes manuais
module.exports = { sendInterestMessages, executeMatcher };
