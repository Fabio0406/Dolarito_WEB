const express = require('express');

function createApiRouter(service) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Cotizaciones actuales + indicadores + estado de la actualización.
  router.get('/rates', (req, res) => {
    res.json(service.snapshot());
  });

  // Serie diaria (zona horaria de Bolivia). ?days=30 (máx. 365)
  router.get('/history', (req, res) => {
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 365);
    res.json({ days, entries: service.getHistory(days) });
  });

  // Dispara una actualización en segundo plano. Responde 202 de inmediato; el cliente consulta /rates.
  router.post('/refresh', (req, res) => {
    const availability = service.manualRefreshAvailability();
    if (!availability.allowed && availability.reason === 'running') {
      return res.status(202).json({ status: 'running', message: 'Ya hay una actualización en curso.' });
    }
    if (!availability.allowed) {
      res.set('Retry-After', String(availability.retryAfter));
      return res.status(429).json({
        status: 'cooldown',
        retryAfter: availability.retryAfter,
        message: `Los datos se actualizaron hace instantes. Puedes volver a intentar en ${availability.retryAfter} s.`,
      });
    }
    service.refresh('manual').catch(() => {});
    return res.status(202).json({ status: 'started', message: 'Actualización iniciada.' });
  });

  router.get('/health', (req, res) => {
    const { lastRun } = service.snapshot().refresh;
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), lastRun });
  });

  router.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));

  return router;
}

module.exports = { createApiRouter };
