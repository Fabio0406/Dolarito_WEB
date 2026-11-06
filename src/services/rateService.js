const path = require('path');
const { EventEmitter } = require('events');
const { readJson, writeJson } = require('../storage/jsonStore');
const { scrapeAll, QUOTE_SOURCES } = require('../scrapers');
const { summarize, localDate, round } = require('./summary');
const logger = require('../utils/logger');

const SCHEMA_VERSION = 2;

/**
 * Estado de una cotización (banco o plataforma digital):
 *  ok          → la última consulta fue exitosa.
 *  stale       → la última consulta falló; se muestra el último valor conocido.
 *  unavailable → nunca se pudo obtener un valor.
 *  unsupported → la entidad no publica su cotización en línea.
 */
function emptyQuote(source) {
  return {
    id: source.id,
    buy: null,
    sell: null,
    status: source.fetch || source.derive ? 'unavailable' : 'unsupported',
    updatedAt: null, // última vez que se obtuvo un valor válido
    checkedAt: null, // último intento de consulta
    error: null,
  };
}

class RateService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ratesFile = path.join(config.dataDir, 'rates.json');
    this.historyFile = path.join(config.dataDir, 'history.json');
    this.current = null; // promesa de la corrida en curso (single-flight)
    this.run = { running: false, trigger: null, startedAt: null, done: 0, total: 0 };
    this.nextRunAt = null;
    this.load();
  }

  load() {
    const stored = readJson(this.ratesFile, null);
    const valid = stored && stored.version === SCHEMA_VERSION;
    // `banks` es el nombre que usaba la versión anterior del archivo.
    const byId = new Map((valid ? stored.quotes ?? stored.banks ?? [] : []).map((b) => [b.id, b]));

    this.state = {
      version: SCHEMA_VERSION,
      lastRun: valid ? stored.lastRun : null,
      official: valid ? stored.official : { value: null, source: null, updatedAt: null },
      // El catálogo manda: fuentes nuevas se agregan y las eliminadas desaparecen.
      quotes: QUOTE_SOURCES.map((source) => ({
        ...emptyQuote(source),
        ...byId.get(source.id),
        ...(source.fetch || source.derive ? {} : { status: 'unsupported' }),
      })),
    };
    this.history = readJson(this.historyFile, []);
    if (!Array.isArray(this.history)) this.history = [];
  }

  get lastRunAt() {
    return this.state.lastRun?.finishedAt ? new Date(this.state.lastRun.finishedAt) : null;
  }

  isRunning() {
    return this.run.running;
  }

  /** Inicia (o reutiliza) una actualización. Nunca hay dos corridas en paralelo. */
  refresh(trigger = 'auto') {
    if (this.current) return this.current;
    this.current = this.doRefresh(trigger).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  /** Comprueba si una actualización manual está permitida (anti-abuso). */
  manualRefreshAvailability(now = Date.now()) {
    if (this.run.running) return { allowed: false, reason: 'running' };
    const cooldownMs = this.config.manualRefreshCooldownSeconds * 1000;
    const last = this.lastRunAt?.getTime() ?? 0;
    const retryAfter = Math.ceil((last + cooldownMs - now) / 1000);
    return retryAfter > 0 ? { allowed: false, reason: 'cooldown', retryAfter } : { allowed: true };
  }

  async doRefresh(trigger) {
    const startedAt = new Date();
    const sourceCount = QUOTE_SOURCES.filter((q) => q.fetch || q.derive).length + 1;
    this.run = { running: true, trigger, startedAt: startedAt.toISOString(), done: 0, total: sourceCount };
    this.emit('change');
    logger.info(`Actualización ${trigger} iniciada (${sourceCount} fuentes)`);

    let results = [];
    try {
      results = await scrapeAll({
        userAgent: this.config.userAgent,
        timeoutMs: this.config.sourceTimeoutMs,
        concurrency: this.config.scrapeConcurrency,
        onResult: (r) => {
          this.run.done += 1;
          logger[r.ok ? 'info' : 'warn'](
            `  ${r.ok ? 'OK   ' : 'FALLO'} ${r.id.padEnd(10)} ${r.durationMs} ms ${r.ok ? JSON.stringify(r.quote) : r.error}`,
          );
        },
      });
    } catch (err) {
      logger.error('Error inesperado durante la actualización:', err);
    }

    const finishedAt = new Date();
    this.applyResults(results, finishedAt);
    this.state.lastRun = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - startedAt,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
    this.recordHistory(finishedAt);
    this.persist();
    this.run = { running: false, trigger: null, startedAt: null, done: 0, total: 0 };
    logger.info(
      `Actualización terminada en ${(this.state.lastRun.durationMs / 1000).toFixed(1)} s: ` +
        `${this.state.lastRun.ok} OK, ${this.state.lastRun.failed} con error`,
    );
    this.emit('change');
    return this.snapshot();
  }

  applyResults(results, now) {
    const iso = now.toISOString();
    const byId = new Map(results.map((r) => [r.id, r]));

    for (const quote of this.state.quotes) {
      const r = byId.get(quote.id);
      if (!r) continue; // fuentes sin scraper (unsupported)
      quote.checkedAt = iso;
      if (r.ok) {
        Object.assign(quote, { buy: r.quote.buy ?? null, sell: r.quote.sell ?? null, status: r.estimated ? 'estimated' : 'ok', updatedAt: iso, error: null });
      } else {
        Object.assign(quote, { status: quote.updatedAt ? 'stale' : 'unavailable', error: r.error });
      }
    }

    // Oficial: primero el BCB; si falla, el valor que reporta la mayoría de bancos.
    const bcb = byId.get('bcb');
    if (bcb?.ok) {
      this.state.official = { value: bcb.quote.official, source: 'bcb', updatedAt: iso };
    } else {
      const consensus = mode(results.filter((r) => r.ok && r.id !== 'bcb').map((r) => r.quote.official ?? null));
      if (consensus !== null) this.state.official = { value: consensus, source: 'banks', updatedAt: iso };
    }
  }

  /** Guarda un punto por día (zona horaria de Bolivia); la última corrida del día lo sobrescribe. */
  recordHistory(now) {
    const date = localDate(now, this.config.timezone);
    // Los promedios del historial son solo de bancos; las cotizaciones individuales incluyen las digitales.
    const summary = summarize(this.quotesOfType('bank'), now.getTime());
    const banks = {};
    for (const q of this.state.quotes) {
      if (q.status === 'ok' || q.status === 'estimated') banks[q.id] = { buy: q.buy, sell: q.sell };
    }
    if (!Object.keys(banks).length && this.state.official.value === null) return;

    const entry = {
      date,
      official: this.state.official.value,
      avgBuy: summary.avgBuy,
      avgSell: summary.avgSell,
      banks,
    };
    const last = this.history[this.history.length - 1];
    if (last?.date === date) this.history[this.history.length - 1] = { ...entry, banks: { ...last.banks, ...banks } };
    else this.history.push(entry);
    this.history = this.history.slice(-this.config.historyDays);
  }

  persist() {
    try {
      writeJson(this.ratesFile, this.state);
      writeJson(this.historyFile, this.history);
    } catch (err) {
      logger.error('No se pudieron guardar los datos:', err.message);
    }
  }

  /** Último registro histórico de un día anterior a hoy (para calcular variaciones). */
  previousDay(now = new Date()) {
    const today = localDate(now, this.config.timezone);
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].date < today) return this.history[i];
    }
    return null;
  }

  /** Representación pública para la API. */
  snapshot() {
    const now = new Date();
    const prev = this.previousDay(now);
    const diff = (a, b) => (a !== null && a !== undefined && b !== null && b !== undefined ? round(a - b) : null);

    const quotes = this.state.quotes.map((quote) => {
      const meta = QUOTE_SOURCES.find((s) => s.id === quote.id);
      const before = prev?.banks?.[quote.id];
      return {
        id: quote.id,
        type: meta.type,
        asset: meta.asset,
        name: meta.name,
        short: meta.short,
        url: meta.url,
        logo: meta.logo,
        note: meta.note || null,
        buy: quote.buy,
        sell: quote.sell,
        status: quote.status,
        updatedAt: quote.updatedAt,
        checkedAt: quote.checkedAt,
        error: quote.error,
        change: { buy: diff(quote.buy, before?.buy), sell: diff(quote.sell, before?.sell) },
      };
    });
    const banks = quotes.filter((q) => q.type === 'bank');
    const digital = quotes.filter((q) => q.type === 'digital');

    return {
      generatedAt: now.toISOString(),
      official: { ...this.state.official, change: diff(this.state.official.value, prev?.official), previousDate: prev?.date ?? null },
      summary: summarize(banks, now.getTime()),
      banks,
      digitalSummary: summarize(digital, now.getTime()),
      digital,
      refresh: {
        running: this.run.running,
        progress: this.run.running ? { done: this.run.done, total: this.run.total, startedAt: this.run.startedAt } : null,
        lastRun: this.state.lastRun,
        nextRunAt: this.nextRunAt ? this.nextRunAt.toISOString() : null,
        intervalMinutes: this.config.refreshIntervalMinutes,
        cooldownSeconds: this.config.manualRefreshCooldownSeconds,
      },
    };
  }

  quotesOfType(type) {
    const ids = new Set(QUOTE_SOURCES.filter((s) => s.type === type).map((s) => s.id));
    return this.state.quotes.filter((q) => ids.has(q.id));
  }

  getHistory(days = 30) {
    return this.history.slice(-days);
  }
}

/** Valor más frecuente de una lista (ignorando nulos). */
function mode(values) {
  const counts = new Map();
  for (const v of values) if (v !== null && v !== undefined) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

module.exports = { RateService, mode };
