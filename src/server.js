const express = require('express');
const fs = require('fs');
const app = express();

app.use(express.json());

app.post('/slack/events', (req, res) => {
  const { type, challenge, event } = req.body;

  // URL verification
  if (type === 'url_verification') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(challenge);
  }

  // Process direct messages
  if (event && event.type === 'message' && event.channel_type === 'im') {
    console.log(`Received message from ${event.user}: ${event.text}`);

    // Save response
    const responsesPath = './data/responses.json';
    let responses = {};

    if (fs.existsSync(responsesPath)) {
      responses = JSON.parse(fs.readFileSync(responsesPath));
    }

    responses[event.user] = event.text;

    fs.writeFileSync(responsesPath, JSON.stringify(responses, null, 2));
  }

  res.status(200).send();
});

module.exports = app;
