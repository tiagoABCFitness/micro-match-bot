const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

module.exports = slackClient;
