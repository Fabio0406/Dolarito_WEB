const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Lee un JSON tolerando archivos inexistentes, vacíos o corruptos.
 * Un archivo corrupto se renombra a *.corrupt para no perder la evidencia.
 */
function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    logger.warn(`No se pudo leer ${path.basename(file)} (${err.message}); se usará el valor por defecto.`);
    try {
      fs.renameSync(file, `${file}.corrupt`);
    } catch {
      /* sin acción */
    }
    return fallback;
  }
}

/** Escritura atómica: escribe a un temporal y lo renombra, así nunca queda un archivo a medias. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson };
