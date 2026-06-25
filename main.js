// RCF operacional: consulte ./RCF.md.
const app = require("./src");

if (require.main === module) {
  app.main();
}

module.exports = app;
