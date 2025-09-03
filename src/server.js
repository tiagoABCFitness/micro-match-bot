// server.js
const express = require('express');
const app = express();
const { saveResponse, getAllResponses, clearResponses } = require('./db');

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

// endpoint para ver tudo
app.get('/debug/responses', async (req, res) => {
  try {
    const responses = await getAllResponses();
    res.json(responses);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// endpoint para limpar
app.get('/debug/clear', async (req, res) => {
  try {
    await clearResponses();
    res.send("Responses cleared");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Endpoint de debug: mostra matches sem criar canais
app.get('/debug/matches', async (req, res) => {
  try {
    const responses = await getAllResponses();

    if (responses.length < 2) {
      return res.json({ message: "Not enough users to match." });
    }

    const matches = [];
    const used = new Set();
    const today = new Date().toISOString().slice(0,10).replace(/-/g,''); // YYYYMMDD

    for (let i = 0; i < responses.length; i++) {
      if (used.has(responses[i].userId)) continue;

      for (let j = i + 1; j < responses.length; j++) {
        if (used.has(responses[j].userId)) continue;

        const common = responses[i].topics.filter(t => responses[j].topics.includes(t));
        if (common.length > 0) {
          const mainTopic = common[0].replace(/\s+/g,'');
          const channelName = `MicroMatchBot-${mainTopic}-${today}`;

          matches.push({
            users: [responses[i].userId, responses[j].userId],
            commonTopics: common,
            simulatedChannel: channelName
          });

          used.add(responses[i].userId);
          used.add(responses[j].userId);
          break;
        }
      }
    }

    res.json(matches);

  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = app;
