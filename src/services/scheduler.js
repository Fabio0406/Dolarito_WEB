const logger = require('../utils/logger');

/**
 * Programa actualizaciones automáticas cada `intervalMinutes`, contando desde la última corrida
 * (incluidas las manuales). Si al arrancar los datos ya están vencidos, actualiza de inmediato.
 */
function startScheduler(service, { intervalMinutes }) {
  const intervalMs = intervalMinutes * 60 * 1000;
  let timer = null;
  let stopped = false;

  const schedule = (minDelay = 0) => {
    if (stopped) return;
    clearTimeout(timer);
    const last = service.lastRunAt?.getTime() ?? 0;
    const delay = Math.max(minDelay, last + intervalMs - Date.now());
    service.nextRunAt = new Date(Date.now() + delay);
    timer = setTimeout(tick, delay);
  };

  const tick = async () => {
    try {
      await service.refresh('auto');
      schedule();
    } catch (err) {
      logger.error('Fallo en la actualización programada:', err);
      schedule(intervalMs); // evita reintentos en bucle
    }
  };

  // Cualquier corrida (también la manual) reinicia la cuenta regresiva.
  service.on('change', () => {
    if (!service.isRunning()) schedule();
  });

  schedule();
  logger.info(`Actualización automática cada ${intervalMinutes} min. Próxima: ${service.nextRunAt.toLocaleString('es-BO')}`);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

module.exports = { startScheduler };
