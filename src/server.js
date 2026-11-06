const express = require('express');
const cors = require('cors');
const config = require('./config');
const { RateService } = require('./services/rateService');
const { startScheduler } = require('./services/scheduler');
const { createApiRouter } = require('./routes/api');
const logger = require('./utils/logger');

const service = new RateService(config);
const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});

// La API de lectura es pública (CORS solo para GET); la actualización manual queda para el propio sitio.
app.use('/api', cors({ methods: ['GET'] }), createApiRouter(service));
app.use(express.static(config.publicDir, { extensions: ['html'] }));

app.use((err, req, res, next) => {
  logger.error('Error no controlado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const server = app.listen(config.port, () => {
  logger.info(`Dolarito (servidor) disponible en http://localhost:${config.port}`);
});
const scheduler = startScheduler(service, { intervalMinutes: config.refreshIntervalMinutes });

const shutdown = (signal) => {
  logger.info(`${signal} recibido, cerrando…`);
  scheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
