// Every outgoing HTTP call times out, so one stuck GitHub or GitLab request can't hold the
// worker forever. OpenRouter calls set their own, longer, timeout (see openRouterService).
const axios = require('axios');

const PLATFORM_TIMEOUT_MS = Number(process.env.PLATFORM_TIMEOUT_MS) || 30_000;
axios.defaults.timeout = PLATFORM_TIMEOUT_MS;

module.exports = { PLATFORM_TIMEOUT_MS };
