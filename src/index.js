// index.js
require('dotenv').config();
const { sendMessageToUsers, sendNoMatchOptions } = require('./messageHandler');
const app = require('./server');
const { runMatcher } = require('./matcher');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

