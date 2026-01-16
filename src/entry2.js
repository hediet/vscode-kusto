// Development entry point with hot reload enabled
process.env.KUSTO_HOT_RELOAD = 'true';

require('tsx/cjs');

// Ensure bridge.js globals are available before loading extension
require('@kusto/language-service-next/bridge.js');

module.exports = require('./extension');
