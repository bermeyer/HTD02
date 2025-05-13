// config/config.js
const process = require('process');
const env = process.env.NODE_ENV || 'development';
const configuration = require('./example_config.json');

module.exports = configuration[env];