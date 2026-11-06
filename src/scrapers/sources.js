const { toRate, normalizeText, section, rateAfter, firstRate, median } = require('./parse');
const { wallbitApiKey } = require('../config');

/**
 * Catálogo de fuentes. Cada banco define cómo obtener su cotización:
 *  - Si el banco expone un endpoint JSON, se usa directamente (rápido y estable).
 *  - Si no, se renderiza la página con Chromium y se extrae por etiquetas cercanas al valor.
 *
 * `fetch` devuelve { buy, sell, official? } en Bs por USD. `buy` = el banco te compra dólares
 * (lo que recibes), `sell` = el banco te vende dólares (lo que pagas).
 * Para agregar un banco basta con añadir una entrada aquí (y su logo 128x128 en public/img/logos/<id>.png).
 */

const DOLAR = 'D[oó]lar';

const BANKS = [
  {
    id: 'bmsc',
    name: 'Banco Mercantil Santa Cruz',
    short: 'BMSC',
    url: 'https://www.bmsc.com.bo/',
    async fetch({ getJson }) {
      const d = await getJson('https://backportal.bmsc.com.bo:1443/api/bmscservices/tipotre');
      return { buy: toRate(d.compra), sell: toRate(d.venta), official: toRate(d.oficial) };
    },
  },
  {
    id: 'bcp',
    name: 'Banco de Crédito de Bolivia',
    short: 'BCP',
    url: 'https://www.bcp.com.bo/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bcp.com.bo/', { waitFor: /D[oó]lar Venta:?\s*\d/i });
      return { buy: rateAfter(t, `${DOLAR} Compra`), sell: rateAfter(t, `${DOLAR} Venta`) };
    },
  },
  {
    id: 'bisa',
    name: 'Banco BISA',
    short: 'BISA',
    url: 'https://www.bisa.com/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bisa.com/', { waitFor: /D[oó]lar Venta\s*\d/i });
      return { buy: rateAfter(t, `${DOLAR} Compra`), sell: rateAfter(t, `${DOLAR} Venta`) };
    },
  },
  {
    id: 'bnb',
    name: 'Banco Nacional de Bolivia',
    short: 'BNB',
    url: 'https://www.bnb.com.bo/',
    async fetch({ getText }) {
      // La franja "Tipos de Cambio" de su portal viene en el HTML del servidor: no hace falta Chromium.
      const t = normalizeText(await getText('https://www.bnb.com.bo/PortalBNB/Principal/BancaPersonas'));
      const s = section(t, 'Tipos de Cambio', 200);
      return {
        buy: rateAfter(s, `${DOLAR} Compra`),
        sell: rateAfter(s, `${DOLAR} Venta`),
        official: rateAfter(s, `${DOLAR} Oficial`),
      };
    },
  },
  {
    id: 'union',
    name: 'Banco Unión',
    short: 'UNIÓN',
    url: 'https://www.bancounion.com.bo/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bancounion.com.bo/', { waitFor: /Compra BOB:?\s*\d/i });
      const s = section(t, `${DOLAR} Oficial`);
      return { buy: rateAfter(s, 'Compra'), sell: rateAfter(s, 'Venta'), official: rateAfter(s, `${DOLAR} Oficial`) };
    },
  },
  {
    id: 'economico',
    name: 'Banco Económico',
    short: 'BEC',
    url: 'https://www.baneco.com.bo/',
    async fetch({ getJson }) {
      const d = await getJson('https://www.baneco.com.bo/gbGLOBALTiposDeCambio');
      const t = normalizeText(d.gbGLOBALTiposDeCambioResult);
      const s = section(t, `Banco Econ[oó]mico por ${DOLAR}`);
      return { buy: rateAfter(s, 'Compra'), sell: rateAfter(s, 'Venta'), official: rateAfter(t, 'oficial del BCB') };
    },
  },
  {
    id: 'ganadero',
    name: 'Banco Ganadero',
    short: 'BG',
    url: 'https://www.bg.com.bo/',
    note: 'Solo publica el valor referencial de venta',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bg.com.bo/personas/', { waitFor: /Venta USD\s*\d/i });
      return { buy: null, sell: rateAfter(t, 'Valor Ref\\. Venta USD'), official: rateAfter(t, 'T\\. Cambio Oficial') };
    },
  },
  {
    id: 'fie',
    name: 'Banco FIE',
    short: 'FIE',
    url: 'https://www.bancofie.com.bo/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bancofie.com.bo/', { waitFor: /D[oó]lar Venta:?\s*\d/i });
      return {
        buy: rateAfter(t, `${DOLAR} Compra`),
        sell: rateAfter(t, `${DOLAR} Venta`),
        official: rateAfter(t, `${DOLAR} Oficial`),
      };
    },
  },
  {
    id: 'bancosol',
    name: 'BancoSol',
    short: 'SOL',
    url: 'https://www.bancosol.com.bo/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bancosol.com.bo/', { waitFor: /cambio venta:?\s*\d/i });
      return {
        buy: rateAfter(t, 'Tipo de cambio compra'),
        sell: rateAfter(t, 'Tipo de cambio venta'),
        official: rateAfter(t, 'Tipo de cambio oficial'),
      };
    },
  },
  {
    id: 'prodem',
    name: 'Banco Prodem',
    short: 'PRODEM',
    url: 'https://www.prodem.bo/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.prodem.bo/', { waitFor: /Banco Prodem\s*Compra\s*\d/i });
      const s = section(t, `Cotizaci[oó]n del ${DOLAR} Banco Prodem`);
      return { buy: rateAfter(s, 'Compra'), sell: rateAfter(s, 'Venta') };
    },
  },
  {
    id: 'fortaleza',
    name: 'Banco Fortaleza',
    short: 'FORT',
    url: 'https://www.bancofortaleza.com.bo/',
    async fetch({ getPageText }) {
      const t = await getPageText('https://www.bancofortaleza.com.bo/', { waitFor: /VENTA\s*\d/ });
      const s = section(t, `Tipo de Cambio ${DOLAR}`);
      return { buy: rateAfter(s, 'Compra'), sell: rateAfter(s, 'Venta'), official: rateAfter(s, 'Oficial') };
    },
  },
];

/**
 * Plataformas digitales (no son bancos). Los mercados P2P cotizan USDT, una stablecoin atada al dólar,
 * no dólares en efectivo; se muestran aparte para no mezclar instrumentos distintos.
 */
const P2P_ADS = 5; // se usa la mediana de los mejores anuncios: más estable que el mejor aislado
const P2P_NOTE = `Mediana de los ${P2P_ADS} mejores anuncios`;

/**
 * Mediana de los mejores anuncios P2P. Se ordena aquí (no se confía en el orden de cada exchange):
 * si el usuario compra, los mejores son los más baratos; si vende, los mejor pagados.
 */
function p2pPrice(prices, userSide, exchange) {
  const valid = prices.map(Number).filter(Number.isFinite);
  if (!valid.length) throw new Error(`${exchange} no devolvió anuncios USDT/BOB`);
  valid.sort((a, b) => (userSide === 'buy' ? a - b : b - a));
  return toRate(median(valid.slice(0, P2P_ADS)));
}

/**
 * Cada función devuelve la mediana para el usuario que compra USDT (`sell`, lo que paga)
 * o que vende USDT (`buy`, lo que recibe).
 */
const P2P = {
  async binance({ postJson }, userSide) {
    const res = await postJson('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      asset: 'USDT',
      fiat: 'BOB',
      tradeType: userSide === 'buy' ? 'BUY' : 'SELL',
      page: 1,
      rows: P2P_ADS,
      payTypes: [],
      publisherType: null,
    });
    if (!res?.success || !Array.isArray(res.data)) throw new Error('Respuesta inesperada de Binance P2P');
    return p2pPrice(res.data.map((ad) => ad.adv?.price), userSide, 'Binance P2P');
  },

  async bybit({ postJson }, userSide) {
    const res = await postJson('https://api2.bybit.com/fiat/otc/item/online', {
      tokenId: 'USDT',
      currencyId: 'BOB',
      payment: [],
      side: userSide === 'buy' ? '1' : '0',
      size: String(P2P_ADS),
      page: '1',
      amount: '',
    });
    if (res?.ret_code !== 0 || !Array.isArray(res.result?.items)) throw new Error('Respuesta inesperada de Bybit P2P');
    return p2pPrice(res.result.items.map((ad) => ad.price), userSide, 'Bybit P2P');
  },

  async okx({ getJson }, userSide) {
    // En OKX el lado es el del anunciante: si el usuario compra, busca anuncios de venta.
    const side = userSide === 'buy' ? 'sell' : 'buy';
    const res = await getJson(
      `https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=BOB&baseCurrency=USDT&side=${side}` +
        '&paymentMethod=all&userType=all&showTrade=false&showFollow=false&showAlreadyTraded=false&isAbleFilter=false',
    );
    const ads = res?.data?.[side];
    if (res?.code !== 0 || !Array.isArray(ads)) throw new Error('Respuesta inesperada de OKX P2P');
    return p2pPrice(ads.map((ad) => ad.price), userSide, 'OKX P2P');
  },

  async bitget({ postJson }, userSide) {
    const res = await postJson('https://www.bitget.com/v1/p2p/pub/adv/queryAdvList', {
      side: userSide === 'buy' ? 1 : 2,
      pageNo: 1,
      pageSize: P2P_ADS,
      coinCode: 'USDT',
      fiatCode: 'BOB',
      languageType: 0,
    });
    if (res?.code !== '00000' || !Array.isArray(res.data?.dataList)) throw new Error('Respuesta inesperada de Bitget P2P');
    return p2pPrice(res.data.dataList.map((ad) => ad.price), userSide, 'Bitget P2P');
  },
};

/** Fuente P2P: consulta ambos lados del libro en paralelo. */
const p2pSource = (exchange) => async (tools) => {
  const [sell, buy] = await Promise.all([P2P[exchange](tools, 'buy'), P2P[exchange](tools, 'sell')]);
  return { buy, sell };
};

/**
 * El Dorado cotiza con su API pública de invitado (la misma que usa su web). Se pide una cotización
 * de referencia de 100 USDT por QR boliviano y se calcula el precio efectivo, comisiones incluidas.
 */
const EL_DORADO_QUOTE = 'https://74j6q7lg6a.execute-api.eu-west-1.amazonaws.com/stage/orderbook/public/v2/quote';
const EL_DORADO_REF = 100;
const EL_DORADO_BOB = { assetType: 'FIAT', asset: 'BOB', paymentMethodId: 'bank_qr_bo' };
const EL_DORADO_USDT = { assetType: 'EL_DORADO', asset: 'TATUM-TRON-USDT' };

async function elDoradoQuote(postJson, body) {
  const res = await postJson(EL_DORADO_QUOTE, { amount: String(EL_DORADO_REF), preview: true, ...body });
  const quote = res?.data?.quote;
  if (!quote) throw new Error('Respuesta inesperada de El Dorado');
  return quote;
}

/**
 * Wallbit: API oficial `GET /api/public/v1/rates` con una API key personal (permiso `read`).
 * Devuelve un único `rate` por par, así que se piden ambos sentidos:
 *  USD→BOB = Bs que recibes por cada dólar (tu venta); BOB→USD = dólares por Bs, se invierte (tu compra).
 */
const WALLBIT_RATES = 'https://api.wallbit.io/api/public/v1/rates';

function createWallbitFetch(apiKey) {
  const pair = async (getJson, from, to) => {
    const res = await getJson(`${WALLBIT_RATES}?source_currency=${from}&dest_currency=${to}`, {
      headers: { 'X-API-Key': apiKey },
    });
    const rate = Number((res?.data ?? res)?.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Wallbit no devolvió la tasa ${from}/${to}`);
    return rate;
  };
  // Acepta la tasa en cualquier sentido (Bs por USD o USD por Bs) y la expresa en Bs por USD.
  const bobPerUsd = (rate) => toRate(rate >= 1 ? rate : 1 / rate);

  return async ({ getJson }) => {
    const [usdToBob, bobToUsd] = await Promise.allSettled([pair(getJson, 'USD', 'BOB'), pair(getJson, 'BOB', 'USD')]);
    if (usdToBob.status === 'rejected' && bobToUsd.status === 'rejected') throw usdToBob.reason;
    return {
      buy: usdToBob.status === 'fulfilled' ? bobPerUsd(usdToBob.value) : null,
      sell: bobToUsd.status === 'fulfilled' ? bobPerUsd(bobToUsd.value) : null,
    };
  };
}

/**
 * Estimación para plataformas que no publican su tasa. Se observa la tasa real en su app una vez,
 * junto con la mediana P2P de ese momento; el margen relativo de cada lado se aplica luego al P2P en vivo.
 * Para recalibrar: anota compra/venta de la app y la mediana P2P del mismo minuto (`npm run scrape`).
 */
const P2P_REFERENCE_IDS = ['binance', 'bybit', 'okx', 'bitget'];

const MERU_CALIBRATION = {
  label: '17 oct 2026',
  observedAt: '2026-10-17T17:09:47Z',
  observed: { buy: 11.78, sell: 12.19 }, // lo que mostraba la app de Meru
  reference: { buy: 11.82, sell: 11.8535 }, // mediana P2P en ese mismo momento
};

/** Mediana P2P en vivo por lado; exige al menos 2 mercados para no depender de uno solo. */
function p2pConsensus(quotes) {
  const side = (field) => {
    const values = P2P_REFERENCE_IDS.map((id) => quotes[id]?.[field]).filter((v) => typeof v === 'number');
    return values.length >= 2 ? median(values) : null;
  };
  return { buy: side('buy'), sell: side('sell') };
}

function estimateFromP2P(quotes, { observed, reference }) {
  const live = p2pConsensus(quotes);
  if (live.buy === null && live.sell === null) throw new Error('Sin suficientes mercados P2P para estimar');
  const scale = (field) => (live[field] === null ? null : toRate((live[field] * observed[field]) / reference[field]));
  return { buy: scale('buy'), sell: scale('sell') };
}

const DIGITAL = [
  {
    id: 'binance',
    name: 'Binance P2P',
    short: 'BNC',
    url: 'https://p2p.binance.com/es/trade/all-payments/USDT?fiat=BOB',
    asset: 'USDT',
    note: P2P_NOTE,
    fetch: p2pSource('binance'),
  },
  {
    id: 'bybit',
    name: 'Bybit P2P',
    short: 'BYBIT',
    url: 'https://www.bybit.com/fiat/trade/otc/buy/USDT/BOB',
    asset: 'USDT',
    note: P2P_NOTE,
    fetch: p2pSource('bybit'),
  },
  {
    id: 'okx',
    name: 'OKX P2P',
    short: 'OKX',
    url: 'https://www.okx.com/es-la/p2p-markets/bob/buy-usdt',
    asset: 'USDT',
    note: P2P_NOTE,
    fetch: p2pSource('okx'),
  },
  {
    id: 'bitget',
    name: 'Bitget P2P',
    short: 'BITGET',
    url: 'https://www.bitget.com/es/p2p-trade?fiatName=BOB',
    asset: 'USDT',
    note: P2P_NOTE,
    fetch: p2pSource('bitget'),
  },
  {
    id: 'eldorado',
    name: 'El Dorado',
    short: 'ELD',
    url: 'https://eldorado.io/',
    asset: 'USDT',
    note: `Precio efectivo con comisiones (cotización de ${EL_DORADO_REF} USDT por QR)`,
    async fetch({ postJson }) {
      const [buyUsdt, sellUsdt] = await Promise.all([
        // El usuario compra 100 USDT: ¿cuántos Bs paga?
        elDoradoQuote(postJson, { fixedSide: 'OUT', in: EL_DORADO_BOB, out: EL_DORADO_USDT }),
        // El usuario vende 100 USDT: ¿cuántos Bs recibe?
        elDoradoQuote(postJson, { fixedSide: 'IN', in: EL_DORADO_USDT, out: EL_DORADO_BOB }),
      ]);
      return {
        sell: toRate(Number(buyUsdt.amountIn?.expected) / EL_DORADO_REF),
        buy: toRate(Number(sellUsdt.amountOut?.expected) / EL_DORADO_REF),
      };
    },
  },
  {
    id: 'takenos',
    name: 'Takenos',
    short: 'TKN',
    url: 'https://takenos.com/tipo-de-cambio',
    asset: 'USD',
    note: 'Billetera digital en dólares',
    async fetch({ getJson }) {
      const list = await getJson('https://app.takenos.com/api/rates?currency=BOB');
      const bob = Array.isArray(list) ? list.find((r) => r.currency === 'BOB') : null;
      if (!bob) throw new Error('Takenos no devolvió la cotización BOB');
      // Para Takenos "buy" es lo que pagas al ingresar Bs (tu compra de USD) y "sell" lo que recibes al retirar.
      return { buy: toRate(bob.sell), sell: toRate(bob.buy) };
    },
  },
  {
    id: 'airtm',
    name: 'Airtm',
    short: 'AIRTM',
    url: 'https://www.airtm.com/es/currency-converter/usd-to-bob/',
    asset: 'USD',
    note: 'Tasa de su convertidor público',
    async fetch({ getBrowserJson }) {
      // Endpoint que alimenta su convertidor público. Responde 403 a clientes HTTP de Node, por eso va por Chromium.
      const d = await getBrowserJson('https://www.airtm.com/es/wp-json/acc/v1/rate/BOB/USD');
      // "add" = Bs que pagas para agregar 1 USD (tu compra); "withdraw" = Bs que recibes al retirar 1 USD.
      return { buy: toRate(d?.withdraw), sell: toRate(d?.add) };
    },
  },
  {
    id: 'wallbit',
    name: 'Wallbit',
    short: 'WALLBIT',
    url: 'https://www.wallbit.io/es/landings/wallbit-bolivia',
    asset: 'USD',
    // Su sitio no publica la cifra; su API oficial sí, pero exige una API key personal (Settings → API Keys).
    ...(wallbitApiKey
      ? { note: 'API oficial de Wallbit', fetch: createWallbitFetch(wallbitApiKey) }
      : { note: 'Requiere tu API key de Wallbit', fetch: null }),
  },
  {
    id: 'meru',
    name: 'Meru',
    short: 'MERU',
    url: 'https://getmeru.com/',
    asset: 'USD',
    // Meru no tiene API pública (su API es solo para empresas) y solo muestra la cotización dentro de la app.
    // Se ESTIMA a partir del P2P en vivo con el margen observado en su app (ver MERU_CALIBRATION).
    fetch: null,
    derive: (quotes) => estimateFromP2P(quotes, MERU_CALIBRATION),
    note: `Estimado con P2P + margen de Meru (calibrado el ${MERU_CALIBRATION.label})`,
  },
  {
    id: 'peso',
    name: 'PE$O',
    short: 'PESO',
    url: 'https://www.peso-latam.com/',
    asset: 'USD',
    // Según su centro de ayuda, la tasa solo aparece dentro de la app (inicio y resumen de cada operación);
    // no la publica en la web y su API (api.peso-latam.com) es privada.
    fetch: null,
    note: 'Solo visible en su app',
  },
];

/** Tipo de cambio oficial publicado por el Banco Central de Bolivia. */
const BCB = {
  id: 'bcb',
  name: 'Banco Central de Bolivia',
  url: 'https://www.bcb.gob.bo/',
  async fetch({ getPageText }) {
    const t = await getPageText('https://www.bcb.gob.bo/', { waitFor: /TIPO DE CAMBIO OFICIAL/i });
    // "TIPO DE CAMBIO OFICIAL Bolivianos por dólar estadounidense JUEVES 15 DE OCTUBRE, 2026 11,68"
    return { official: firstRate(section(t, 'TIPO DE CAMBIO OFICIAL', 140)) };
  },
};

const withMeta = (type) => (source) => ({ type, asset: 'USD', ...source, logo: `img/logos/${source.id}.png` });

/** Todas las cotizaciones que se muestran: bancos primero, luego plataformas digitales. */
const QUOTE_SOURCES = [...BANKS.map(withMeta('bank')), ...DIGITAL.map(withMeta('digital'))];

module.exports = { QUOTE_SOURCES, BCB, createWallbitFetch, estimateFromP2P, MERU_CALIBRATION };
