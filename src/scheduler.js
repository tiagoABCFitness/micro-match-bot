const cron = require('node-cron');
const { sendMessageToUsers } = require('./messageHandler');

function scheduleMessage() {
  cron.schedule('0 13 * * 2', async () => {
    const message = `Olá! Quais são os teus interesses hoje? Responde com uma das categorias: "movies", "games", "fitness".`;
    await sendMessageToUsers(message);
    console.log('Mensagem enviada!');
  });
}

module.exports = { scheduleMessage };
