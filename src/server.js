// server.js
const express = require('express');
const app = express();
const { saveResponse } = require('./db');

app.use(express.json());

app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === 'url_verification') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(challenge);
  }

  if (event && event.type === 'message' && event.channel_type === 'im' && !event.bot_id) {
    console.log(`Received message from ${event.user}: ${event.text}`);

    const topics = event.text
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    try {
      await saveResponse(event.user, topics);
      console.log(`Saved response for ${event.user}:`, topics);
    } catch (err) {
      console.error('DB error:', err.message);
    }
  }

  res.status(200).send();
});

module.exports = app;
