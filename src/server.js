const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Para slash commands (application/x-www-form-urlencoded) e JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * Endpoint para receber eventos do Slack (event subscriptions)
 */
app.post('/slack/events', (req, res) => {
  const { type, challenge, event } = req.body;

  // URL verification
  if (type === 'url_verification') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(challenge);
  }

  // Process direct messages (DMs)
  if (event && event.type === 'message' && event.channel_type === 'im') {
    console.log(`Received message from ${event.user}: ${event.text}`);

    // Salva as respostas (pode migrar para banco depois)
    const responsesPath = path.join(__dirname, 'data', 'responses.json');
    let responses = {};

    if (fs.existsSync(responsesPath)) {
      responses = JSON.parse(fs.readFileSync(responsesPath));
    }

    responses[event.user] = event.text;

    fs.writeFileSync(responsesPath, JSON.stringify(responses, null, 2));
  }

  res.status(200).send();
});

/**
 * Endpoint para /join (slash command)
 */
app.post('/slack/join', (req, res) => {
  const userId = req.body.user_id;

  if (!userId) {
    return res.status(400).send('No user ID received');
  }

  const usersPath = path.join(__dirname, 'data', 'users.json');
  let users = [];

  if (fs.existsSync(usersPath)) {
    users = JSON.parse(fs.readFileSync(usersPath));
  }

  if (!users.includes(userId)) {
    users.push(userId);
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  }

  res.send(`User <@${userId}> added successfully!`);
});

module.exports = app;
