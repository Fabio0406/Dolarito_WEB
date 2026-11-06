const LOCALE = 'es-BO';
const twoDecimals = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const upToTwo = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const longDateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long', timeStyle: 'short' });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 11.68 → "11,68" */
export const rate = (v) => (isNum(v) ? twoDecimals.format(v) : '—');
/** 1168 → "Bs 1.168,00" */
export const bs = (v) => (isNum(v) ? `Bs ${twoDecimals.format(v)}` : '—');
/** 1000 → "1.000"; 1500.5 → "1.500,50" */
export const amount = (v) => (isNum(v) ? (Number.isInteger(v) ? upToTwo : twoDecimals).format(v) : '');
/** 1000 → "US$ 1.000"; 1500.5 → "US$ 1.500,50" */
export const usd = (v) => (isNum(v) ? `US$ ${amount(v)}` : '—');
/** 0.02 → "+0,02"; usa el signo menos tipográfico. */
export const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + twoDecimals.format(Math.abs(v));

/** "2026-10-15" → "15 oct" */
export const dayLabel = (isoDate) => shortDate.format(new Date(`${isoDate}T12:00:00`)).replace('.', '');
export const dateTime = (iso) => longDateTime.format(new Date(iso));

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return 'hace instantes';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

export function timeUntil(iso, now = Date.now()) {
  if (!iso) return '';
  const minutes = Math.round((Date.parse(iso) - now) / 60000);
  if (minutes < 1) return 'en instantes';
  if (minutes < 60) return `en ${minutes} min`;
  return `en ${Math.round(minutes / 60)} h`;
}

/**
 * Interpreta montos escritos a la boliviana o internacional:
 * "1.000" → 1000, "1.000,50" → 1000.5, "1000.5" → 1000.5, "250,75" → 250.75
 */
export function parseAmount(input) {
  let s = String(input).trim().replace(/\s|US\$|\$/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    s = s.split(decimal === ',' ? '.' : ',').join('').replace(decimal, '.');
  } else if (lastComma > -1) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 1e9 ? n : null;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
