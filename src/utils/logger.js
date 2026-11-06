const stamp = () => new Date().toISOString();

const log = (level, ...args) => {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${stamp()}] ${level.toUpperCase().padEnd(5)}`, ...args);
};

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};
