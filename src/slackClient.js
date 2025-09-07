require('dotenv').config();
const { WebClient } = require('@slack/web-api');

console.log("Slack Token:", process.env.SLACK_BOT_TOKEN ? "Loaded" : "Missing");

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

module.exports = slackClient;