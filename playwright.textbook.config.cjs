const base = require('./playwright.baseline.config.cjs');
module.exports = {...base, testMatch:process.env.NB_BOOK_LISTEN==='1'?['textbook-listen.spec.cjs']:['native-baseline.spec.cjs','textbook-journey.spec.cjs','textbook-access.spec.cjs','textbook-privacy.spec.cjs','textbook-exact-anchor.spec.cjs']};
