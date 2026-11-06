const { ScrapeContext } = require('./context');
const { validateQuote } = require('./parse');
const { QUOTE_SOURCES, BCB } = require('./sources');

const withTimeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${Math.round(ms / 1000)} s) en ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** Ejecuta `worker` sobre `items` con un máximo de `limit` tareas simultáneas. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Consulta todas las fuentes y devuelve un resultado por fuente, sin lanzar nunca:
 * { id, ok, quote?, error?, durationMs }
 */
async function scrapeAll({ userAgent, timeoutMs, concurrency, onResult = () => {} }) {
  const ctx = new ScrapeContext({ userAgent, timeoutMs });
  const tools = {
    getJson: (url, options) => ctx.getJson(url, options),
    getText: (url, options) => ctx.getText(url, options),
    postJson: (url, payload) => ctx.postJson(url, payload),
    getPageText: (url, opts) => ctx.getPageText(url, opts),
    getBrowserJson: (url) => ctx.getBrowserJson(url),
  };
  const sources = [BCB, ...QUOTE_SOURCES].filter((s) => typeof s.fetch === 'function');

  let results;
  try {
    results = await mapWithConcurrency(sources, concurrency, async (source) => {
      const started = Date.now();
      let result;
      try {
        const quote = await withTimeout(source.fetch(tools), timeoutMs + 5000, source.name);
        if (source !== BCB) validateQuote(quote, { maxCross: source.type === 'digital' ? 0.03 : 0 });
        else if (!quote.official) throw new Error('No se encontró el tipo de cambio oficial');
        result = { id: source.id, ok: true, quote };
      } catch (err) {
        result = { id: source.id, ok: false, error: err.message.split('\n')[0] };
      }
      result.durationMs = Date.now() - started;
      onResult(result);
      return result;
    });
  } finally {
    await ctx.close();
  }
  return [...results, ...deriveAll(results, onResult)];
}

/**
 * Fuentes derivadas: no se consultan, se calculan a partir de las cotizaciones recién obtenidas
 * (p. ej. Meru, estimado desde el P2P). Su resultado lleva `estimated: true`.
 */
function deriveAll(results, onResult) {
  const okQuotes = Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.id, r.quote]));
  return QUOTE_SOURCES.filter((s) => typeof s.derive === 'function').map((source) => {
    let result;
    try {
      result = { id: source.id, ok: true, estimated: true, quote: validateQuote(source.derive(okQuotes), { maxCross: 0.03 }) };
    } catch (err) {
      result = { id: source.id, ok: false, error: err.message };
    }
    result.durationMs = 0;
    onResult(result);
    return result;
  });
}

module.exports = { scrapeAll, mapWithConcurrency, QUOTE_SOURCES, BCB };
