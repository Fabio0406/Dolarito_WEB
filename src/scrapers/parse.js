// Rango de cordura para una cotización Bs/USD. Fuera de esto asumimos que el patrón capturó otro número.
const RATE_MIN = 5;
const RATE_MAX = 30;

const RATE_PATTERN = '(\\d{1,2}[.,]\\d{2,5})';

/** Convierte "11,68", "11.68" o 11.68 a número. */
function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const n = Number(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Igual que toNumber, pero descarta valores fuera del rango razonable para el dólar en Bolivia. */
function toRate(raw) {
  const n = toNumber(raw);
  if (n === null || n < RATE_MIN || n > RATE_MAX) return null;
  return Math.round(n * 10000) / 10000;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Devuelve el fragmento de texto que empieza en `label` (regex como string), o null si no existe. */
function section(text, label, length = 400) {
  const m = new RegExp(label, 'i').exec(text);
  return m ? text.slice(m.index, m.index + length) : null;
}

/**
 * Primera cotización que aparece después de `label`, permitiendo solo texto sin dígitos en medio
 * (p. ej. "Dólar Compra: 10,78" o "COMPRA | 11.38 Bs."). Evita capturar números de otros campos.
 */
function rateAfter(text, label, maxGap = 60) {
  if (!text) return null;
  const re = new RegExp(`${label}[^\\d]{0,${maxGap}}?${RATE_PATTERN}`, 'i');
  const m = re.exec(text);
  return m ? toRate(m[1]) : null;
}

/** Primera cotización válida dentro del texto (ignorando fechas y años). */
function firstRate(text) {
  if (!text) return null;
  const re = new RegExp(`(?<![\\d.,])${RATE_PATTERN}(?!\\d)`, 'g');
  for (const m of text.matchAll(re)) {
    const rate = toRate(m[1]);
    if (rate !== null) return rate;
  }
  return null;
}

/** Mediana de una lista de números (null si está vacía). */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Valida una cotización extraída. Lanza un error descriptivo si no es coherente.
 * En un banco la compra nunca supera a la venta. En mercados P2P sí puede pasar un poco (libro
 * "cruzado" por distintos medios de pago y límites), así que se tolera hasta `maxCross` (fracción).
 */
function validateQuote(quote, { maxCross = 0 } = {}) {
  const { buy = null, sell = null } = quote || {};
  if (buy === null && sell === null) throw new Error('No se encontró la cotización en la página');
  if (buy !== null && sell !== null && buy > sell * (1 + maxCross)) {
    throw new Error(`Cotización incoherente: compra ${buy} mayor que venta ${sell}`);
  }
  return quote;
}

module.exports = { toNumber, toRate, normalizeText, section, rateAfter, firstRate, median, validateQuote, RATE_MIN, RATE_MAX };
