const { sendInterestMessages } = require('./src/index');

(async () => {
  try {
    await sendInterestMessages();
  } catch (err) {
    console.error(err);
  }
})();