const randomInt = (min, max) => {
  const safeMin = Math.ceil(min);
  const safeMax = Math.floor(max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
};

const delay = async (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const randomDelay = async (minMs, maxMs) => {
  const waitMs = randomInt(minMs, maxMs);
  await delay(waitMs);
  return waitMs;
};

export { delay, randomDelay, randomInt };
