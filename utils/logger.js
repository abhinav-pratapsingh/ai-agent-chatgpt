const logLevelOrder = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const configuredLevel = process.env.LOG_LEVEL ?? "info";

const shouldLog = (level) => {
  return logLevelOrder[level] <= logLevelOrder[configuredLevel];
};

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const metaText = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaText}`;
};

const log = (level, message, meta) => {
  if (!shouldLog(level)) {
    return;
  }

  const output = formatMessage(level, message, meta);

  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
};

const logger = {
  error: (message, meta) => log("error", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  info: (message, meta) => log("info", message, meta),
  debug: (message, meta) => log("debug", message, meta)
};

export { logger };
