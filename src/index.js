const { sendMessageToUsers } = require('./messageHandler');
const app = require('./server');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Mensagem inicial opcional (de preferência, acionada depois)
async function sendInitialMessages() {
  try {
    const message = `Hi there! What are your interests today? Reply with one or more categories.`;
    await sendMessageToUsers(message);
    console.log('Message sent successfully!');
  } catch (error) {
    console.error('Error sending message:', error.message);
  }
}

// enviar depois do start ou manualmente
// sendInitialMessages();
