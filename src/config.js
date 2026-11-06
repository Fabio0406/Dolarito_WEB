const path = require('path');

// Variables locales opcionales (p. ej. WALLBIT_API_KEY) desde .env, que no se versiona.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sin .env: se usan solo las variables del entorno */
}

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = Object.freeze({
  port: positiveInt(process.env.PORT, 3000),
  timezone: 'America/La_Paz',

  // Frecuencia de la actualización automática (los bancos cambian su pizarra pocas veces al día).
  refreshIntervalMinutes: positiveInt(process.env.REFRESH_INTERVAL_MINUTES, 30),
  // Tiempo mínimo entre actualizaciones manuales disparadas desde la web.
  manualRefreshCooldownSeconds: positiveInt(process.env.MANUAL_REFRESH_COOLDOWN_SECONDS, 60),

  scrapeConcurrency: positiveInt(process.env.SCRAPE_CONCURRENCY, 4),
  sourceTimeoutMs: positiveInt(process.env.SOURCE_TIMEOUT_MS, 45000),
  historyDays: positiveInt(process.env.HISTORY_DAYS, 90),

  // Clave personal de la API de Wallbit (permiso `read`). Sin ella, Wallbit se muestra sin cotización.
  wallbitApiKey: process.env.WALLBIT_API_KEY?.trim() || null,

  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  publicDir: path.join(__dirname, '..', 'public'),

  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
