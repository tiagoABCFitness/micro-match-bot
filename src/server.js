const express = require('express');
const app = express();

app.use(express.json());

app.post('/slack/events', (req, res) => {
  const { type, challenge, event } = req.body;

  // url verification
  if (type === 'url_verification') {
    return res.status(200).send(challenge);
  }


  // process messages
  if (event && event.type === 'message' && event.channel_type === 'im') {
    console.log(`received message from ${event.user}: ${event.text}`);
    // save/reply messages
  }

  res.status(200).send();
});

module.exports = app;
