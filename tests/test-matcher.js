const { executeMatcher } = require('./src/index');

(async () => {
  try {
    await executeMatcher();
  } catch (err) {
    console.error(err);
  }
})();