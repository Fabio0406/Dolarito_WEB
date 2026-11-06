const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { toRate, rateAfter, firstRate, section, normalizeText, validateQuote, median } = require('../src/scrapers/parse');
const { QUOTE_SOURCES, createWallbitFetch, estimateFromP2P, MERU_CALIBRATION } = require('../src/scrapers/sources');
const { summarize } = require('../src/services/summary');
const { mode } = require('../src/services/rateService');

// Fragmentos reales tomados de los sitios de los bancos (octubre 2026).
const SAMPLES = {
  fie: 'TIPOS DE CAMBIO AL 15 de octubre 2026: Dólar Oficial: 11,68 Dólar Compra: 10,78 Dólar Venta: 11,78 EURO BCB: 13,02670',
  prodem:
    'Cotización del dólar oficial BCB Bolivianos por dólar estadounidense 11.68 Cotización del dólar Banco Prodem Compra 11.38 Venta 11.78 TRe MN 3.70',
  fortaleza: 'Seguro Cyber tus compras y tu vida digital. Tipo de Cambio DÓLAR OFICIAL 11.68 Bs. COMPRA 11.38 Bs. VENTA 11.98 Bs. UFV',
  bmscUfv: 'UFV: Compra: 3.35831 Venta: 3.35831 Aviso Legal',
  bcb: 'TIPO DE CAMBIO OFICIAL Bolivianos por dólar estadounidense JUEVES 15 DE OCTUBRE, 2026 11,68 Más información',
  economico:
    'Tipo de Cambio oficial del BCB: <br>Bs. 11.68<br>Tipo de Cambio Banco Económico por Dólar: <br>Compra: 10.68 - Venta: 12.03 <br>Unidad de Fomento',
};

test('toRate acepta coma o punto decimal y descarta valores fuera de rango', () => {
  assert.equal(toRate('11,68'), 11.68);
  assert.equal(toRate('11.68'), 11.68);
  assert.equal(toRate(10.5), 10.5);
  assert.equal(toRate('3.35831'), null); // UFV, no es dólar
  assert.equal(toRate('abc'), null);
  assert.equal(toRate(null), null);
});

test('rateAfter extrae compra/venta de FIE', () => {
  assert.equal(rateAfter(SAMPLES.fie, 'D[oó]lar Compra'), 10.78);
  assert.equal(rateAfter(SAMPLES.fie, 'D[oó]lar Venta'), 11.78);
  assert.equal(rateAfter(SAMPLES.fie, 'D[oó]lar Oficial'), 11.68);
});

test('section acota la búsqueda al bloque correcto (Prodem, Fortaleza)', () => {
  const prodem = section(SAMPLES.prodem, 'Cotizaci[oó]n del D[oó]lar Banco Prodem');
  assert.equal(rateAfter(prodem, 'Compra'), 11.38);
  assert.equal(rateAfter(prodem, 'Venta'), 11.78);

  const fortaleza = section(SAMPLES.fortaleza, 'Tipo de Cambio D[oó]lar');
  assert.equal(rateAfter(fortaleza, 'Compra'), 11.38);
  assert.equal(rateAfter(fortaleza, 'Venta'), 11.98);
});

test('no confunde la UFV con el dólar', () => {
  assert.equal(rateAfter(SAMPLES.bmscUfv, 'Compra'), null);
});

test('firstRate ignora fechas y años (BCB)', () => {
  assert.equal(firstRate(section(SAMPLES.bcb, 'TIPO DE CAMBIO OFICIAL', 140)), 11.68);
});

test('normalizeText limpia HTML (Banco Económico)', () => {
  const t = normalizeText(SAMPLES.economico);
  const s = section(t, 'Banco Econ[oó]mico por D[oó]lar');
  assert.equal(rateAfter(s, 'Compra'), 10.68);
  assert.equal(rateAfter(s, 'Venta'), 12.03);
  assert.equal(rateAfter(t, 'oficial del BCB'), 11.68);
});

test('validateQuote rechaza datos vacíos o incoherentes', () => {
  assert.throws(() => validateQuote({ buy: null, sell: null }));
  assert.throws(() => validateQuote({ buy: 12, sell: 11 }));
  assert.deepEqual(validateQuote({ buy: null, sell: 11.98 }), { buy: null, sell: 11.98 });
});

test('validateQuote tolera un libro P2P levemente cruzado, pero no errores groseros', () => {
  const crossed = { buy: 11.85, sell: 11.84 }; // caso real de Binance P2P (oct. 2026)
  assert.throws(() => validateQuote(crossed)); // para un banco sería un error
  assert.deepEqual(validateQuote(crossed, { maxCross: 0.03 }), crossed);
  assert.throws(() => validateQuote({ buy: 13, sell: 11.84 }, { maxCross: 0.03 }));
});

test('summarize calcula mejores tasas solo con datos recientes', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const fresh = '2026-10-15T11:00:00Z';
  const old = '2026-10-10T11:00:00Z';
  const s = summarize(
    [
      { id: 'a', buy: 10.5, sell: 11.98, updatedAt: fresh },
      { id: 'b', buy: 11.38, sell: 11.78, updatedAt: fresh },
      { id: 'c', buy: 11.9, sell: 11.5, updatedAt: old }, // antiguo: se ignora
      { id: 'd', buy: null, sell: 11.78, updatedAt: fresh },
    ],
    now,
  );
  assert.deepEqual(s.bestSell, { value: 11.78, banks: ['b', 'd'] });
  assert.deepEqual(s.bestBuy, { value: 11.38, banks: ['b'] });
  assert.equal(s.reporting, 3);
  assert.equal(s.avgBuy, 10.94);
});

test('mode devuelve el valor más frecuente', () => {
  assert.equal(mode([11.68, 11.68, 11.7, null]), 11.68);
  assert.equal(mode([]), null);
});

test('median es robusta ante anuncios atípicos (Binance P2P)', () => {
  assert.equal(median([11.83, 11.83, 11.84, 15]), 11.835);
  assert.equal(median([11.8, 11.79, 11.8]), 11.8);
  assert.equal(median([]), null);
});

test('cada fuente tiene id único, tipo y un logo existente', () => {
  const ids = QUOTE_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of QUOTE_SOURCES) {
    assert.ok(['bank', 'digital'].includes(s.type), `${s.id} sin tipo válido`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', s.logo)), `Falta el logo de ${s.id}`);
  }
});

test('Wallbit: envía la API key y expresa ambos sentidos en Bs por USD', async () => {
  const calls = [];
  const getJson = async (url, options) => {
    calls.push({ url, key: options?.headers?.['X-API-Key'] });
    if (url.includes('source_currency=USD')) return { data: { rate: 11.65 } };
    return { data: { rate: 1 / 12.05 } }; // BOB→USD: dólares por boliviano
  };
  const quote = await createWallbitFetch('clave-de-prueba')({ getJson });
  assert.deepEqual(quote, { buy: 11.65, sell: 12.05 });
  assert.ok(calls.every((c) => c.key === 'clave-de-prueba'));
});

test('Wallbit: si solo existe un sentido, el otro queda vacío; si ninguno, falla', async () => {
  const onlyUsd = async (url) => {
    if (url.includes('source_currency=USD')) return { rate: 11.6 };
    throw new Error('HTTP 404 en api.wallbit.io');
  };
  assert.deepEqual(await createWallbitFetch('k')({ getJson: onlyUsd }), { buy: 11.6, sell: null });
  const none = async () => {
    throw new Error('HTTP 401 en api.wallbit.io');
  };
  await assert.rejects(createWallbitFetch('k')({ getJson: none }), /401/);
});

test('Meru estimado: reproduce lo observado y sigue los movimientos del P2P', () => {
  const at = (buy, sell) => ({ binance: { buy, sell }, bybit: { buy, sell }, okx: { buy, sell } });
  const { reference, observed } = MERU_CALIBRATION;

  // Con el mismo P2P de la calibración, la estimación es exactamente lo que mostraba la app.
  assert.deepEqual(estimateFromP2P(at(reference.buy, reference.sell), MERU_CALIBRATION), observed);

  // Si el P2P sube 1%, la estimación sube 1% en ambos lados.
  const up = estimateFromP2P(at(reference.buy * 1.01, reference.sell * 1.01), MERU_CALIBRATION);
  assert.ok(Math.abs(up.sell - observed.sell * 1.01) < 0.001);
  assert.ok(Math.abs(up.buy - observed.buy * 1.01) < 0.001);
});

test('Meru estimado: no estima con un solo mercado P2P', () => {
  assert.throws(() => estimateFromP2P({ binance: { buy: 11.8, sell: 11.85 } }, MERU_CALIBRATION), /P2P/);
});

test('summarize ignora las cotizaciones estimadas', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const t = '2026-10-17T11:00:00Z';
  const s = summarize(
    [
      { id: 'p2p', buy: 11.82, sell: 11.85, status: 'ok', updatedAt: t },
      { id: 'meru', buy: 11.9, sell: 11.5, status: 'estimated', updatedAt: t },
    ],
    now,
  );
  assert.deepEqual(s.bestSell, { value: 11.85, banks: ['p2p'] });
  assert.equal(s.reporting, 1);
});

test('BNB: franja "Tipos de Cambio" de su portal (HTML real, nov 2026)', () => {
  const html =
    '<span class="textoverde3c fuente-bold">\n Tipos de Cambio\n</span>\n<span class="calbold textoplomo8c">\n Dólar Compra\n</span>\n' +
    '<span class="textoplomo8c">\n 11.56\n</span>\n<span class="fuente-bold textoplomo8c">\n Dólar Venta\n</span>\n' +
    '<span class="textoplomo8c">\n 12.36\n</span>\n<span class="fuente-bold textoplomo8c">\n Dólar Oficial\n</span>\n' +
    '<span class="textoplomo8c">\n 12.06\n</span>\n<span class="fuente-bold textoplomo8c">\n UFV\n</span>\n' +
    '<span class="textoplomo8c">\n 3.36839\n</span>\n&nbsp;\n<span class="textoverde3c fuente-bold">\n Tasa Referencial TRe&nbsp;\n</span>';
  const s = section(normalizeText(html), 'Tipos de Cambio', 200);
  assert.equal(rateAfter(s, 'D[oó]lar Compra'), 11.56);
  assert.equal(rateAfter(s, 'D[oó]lar Venta'), 12.36);
  assert.equal(rateAfter(s, 'D[oó]lar Oficial'), 12.06);
});
