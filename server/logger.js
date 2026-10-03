// Structured logger with log level filtering, timestamps, and HTTP request metrics.
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = () => {
  const env = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[env] !== undefined ? LEVELS[env] : LEVELS.info;
};

function formatMessage(level, message, ...meta) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const metaStr = meta.length ? " " + meta.map((m) => (m instanceof Error ? m.stack || m.message : typeof m === "object" ? JSON.stringify(m) : m)).join(" ") : "";
  return `${prefix} ${message}${metaStr}`;
}

const logger = {
  debug(message, ...meta) {
    if (currentLevel() <= LEVELS.debug) {
      console.debug(formatMessage("debug", message, ...meta));
    }
  },
  info(message, ...meta) {
    if (currentLevel() <= LEVELS.info) {
      console.log(formatMessage("info", message, ...meta));
    }
  },
  warn(message, ...meta) {
    if (currentLevel() <= LEVELS.warn) {
      console.warn(formatMessage("warn", message, ...meta));
    }
  },
  error(message, ...meta) {
    if (currentLevel() <= LEVELS.error) {
      console.error(formatMessage("error", message, ...meta));
    }
  },
  request(req, res, durationMs) {
    if (currentLevel() <= LEVELS.info) {
      const status = res.statusCode || 200;
      const method = req.method;
      // Without the query string: it can hold what you searched for
      const url = (req.url || "/").split("?")[0];
      const timing = `${durationMs.toFixed(1)}ms`;
      console.log(formatMessage("info", `${method} ${url} ${status} - ${timing}`));
    }
  },
};

module.exports = logger;
