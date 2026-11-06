const { chromium } = require('playwright');
const { normalizeText } = require('./parse');

const BLOCKED_RESOURCES = new Set(['image', 'media', 'font']);

/**
 * Herramientas compartidas por todas las fuentes durante una corrida de scraping.
 * El navegador se lanza solo si alguna fuente lo necesita y se reutiliza entre páginas.
 */
class ScrapeContext {
  constructor({ userAgent, timeoutMs }) {
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.browserPromise = null;
  }

  async getText(url, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...headers },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
    return res.text();
  }

  async getJson(url, options) {
    const body = await this.getText(url, options);
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`Respuesta no es JSON válido en ${new URL(url).host}`);
    }
  }

  postJson(url, payload) {
    return this.getJson(url, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  }

  /**
   * Renderiza una página con Chromium y devuelve su texto visible normalizado.
   * `waitFor` (RegExp) espera a que el texto aparezca, útil en sitios que cargan la cotización por JS.
   */
  async getPageText(url, { waitFor } = {}) {
    const context = await this.browserContext();
    const page = await context.newPage();
    try {
      await page.route('**/*', (route) =>
        BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });

      if (waitFor) {
        await page
          .waitForFunction(
            ({ source, flags }) => new RegExp(source, flags).test(document.body?.innerText || ''),
            { source: waitFor.source, flags: waitFor.flags },
            { timeout: Math.min(20000, this.timeoutMs) },
          )
          .catch(() => {}); // Si no aparece, el extractor reportará el error con más contexto.
      } else {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }

      return normalizeText(await page.innerText('body'));
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Abre un endpoint JSON público con Chromium. Sirve para sitios que rechazan clientes HTTP de Node
   * por su huella de conexión pero responden con normalidad a un navegador (p. ej. Airtm).
   */
  async getBrowserJson(url) {
    const context = await this.browserContext();
    const page = await context.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      if (!res?.ok()) throw new Error(`HTTP ${res?.status() ?? '?'} en ${new URL(url).host}`);
      try {
        return await res.json();
      } catch {
        throw new Error(`Respuesta no es JSON válido en ${new URL(url).host}`);
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  browserContext() {
    if (!this.browserPromise) {
      this.browserPromise = chromium
        .launch({ headless: true })
        .then(async (browser) => ({
          browser,
          context: await browser.newContext({ userAgent: this.userAgent, locale: 'es-BO', ignoreHTTPSErrors: true }),
        }));
    }
    return this.browserPromise.then(({ context }) => context);
  }

  async close() {
    if (!this.browserPromise) return;
    const { browser } = await this.browserPromise.catch(() => ({}));
    this.browserPromise = null;
    await browser?.close().catch(() => {});
  }
}

module.exports = { ScrapeContext };
