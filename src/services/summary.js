// Una cotización sin confirmar por más de este tiempo no entra en los indicadores del mercado.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const round = (n, digits = 4) => (n === null || n === undefined ? null : Math.round(n * 10 ** digits) / 10 ** digits);
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const isRecent = (bank, now = Date.now()) =>
  Boolean(bank.updatedAt) && now - new Date(bank.updatedAt).getTime() < STALE_AFTER_MS;

/** Mejor valor (mínimo o máximo) y los bancos que lo ofrecen. */
function best(banks, field, pick) {
  const values = banks.map((b) => b[field]).filter((v) => v !== null && v !== undefined);
  if (!values.length) return null;
  const value = pick(...values);
  return { value, banks: banks.filter((b) => b[field] === value).map((b) => b.id) };
}

/** Indicadores agregados del mercado a partir de las cotizaciones recientes. */
function summarize(banks, now = Date.now()) {
  // Las estimaciones no compiten por "mejor precio" ni entran en los promedios: no son tasas publicadas.
  const recent = banks.filter((b) => b.status !== 'estimated' && isRecent(b, now));
  const buys = recent.map((b) => b.buy).filter((v) => v !== null);
  const sells = recent.map((b) => b.sell).filter((v) => v !== null);
  const avgBuy = avg(buys);
  const avgSell = avg(sells);

  return {
    reporting: recent.length,
    total: banks.length,
    bestSell: best(recent, 'sell', Math.min), // dónde conviene comprar USD
    bestBuy: best(recent, 'buy', Math.max), // dónde conviene vender USD
    avgBuy: round(avgBuy),
    avgSell: round(avgSell),
    avgSpread: avgBuy !== null && avgSell !== null ? round(avgSell - avgBuy) : null,
  };
}

/** Fecha calendario (YYYY-MM-DD) en la zona horaria indicada. */
function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

module.exports = { summarize, localDate, isRecent, round, STALE_AFTER_MS };
