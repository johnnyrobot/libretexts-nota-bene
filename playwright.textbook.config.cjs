const base = require('./playwright.baseline.config.cjs');
module.exports = {...base, testMatch:['native-baseline.spec.cjs','textbook-journey.spec.cjs','textbook-access.spec.cjs']};
