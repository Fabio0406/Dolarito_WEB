import { getRates, getHistory, requestRefresh } from './api.js';
import { renderChart } from './chart.js';
import { rate, bs, usd, amount as formatAmount, signed, dayLabel, dateTime, relativeTime, timeUntil, parseAmount, escapeHtml } from './format.js';

/* ---------------------------------------------------------------------------
   Configuración y estado
   --------------------------------------------------------------------------- */
const POLL_MS = 60_000; // refresco normal de la página
const POLL_RUNNING_MS = 2_000; // mientras el servidor consulta a los bancos
const STATUS_TICK_MS = 30_000; // refresco de los "hace X min"

const OPERATIONS = {
  buyUsd: { field: 'sell', totalLabel: 'Pagas', resultLabel: 'Pagas como mínimo', better: 'low', worstLabel: 'Opción más cara' },
  sellUsd: { field: 'buy', totalLabel: 'Recibes', resultLabel: 'Recibes como máximo', better: 'high', worstLabel: 'Opción menos conveniente' },
};

const STATUS = {
  ok: { icon: 'i-check', label: 'Al día' },
  stale: { icon: 'i-alert', label: 'Desactualizado' },
  unavailable: { icon: 'i-alert', label: 'Sin datos' },
  unsupported: { icon: 'i-minus', label: 'Sin publicación' },
  estimated: { icon: 'i-info', label: 'Estimado' },
};

const state = {
  data: null,
  history: [],
  historyKey: null,
  op: 'buyUsd',
  amount: 100,
  query: '',
  sort: null, // null = automático según la operación
  connectionError: false,
  failedPolls: 0,
  manualRefresh: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  sync: $('syncStatus'),
  btnRefresh: $('btnRefresh'),
  btnTheme: $('btnTheme'),
  progress: $('progress'),
  alerts: $('alertRegion'),
  tbody: $('ratesBody'),
  digitalBody: $('digitalBody'),
  empty: $('emptyState'),
  search: $('searchInput'),
  amount: $('amountInput'),
  chart: $('chart'),
  toasts: $('toasts'),
};

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible */
    }
  },
};

/* ---------------------------------------------------------------------------
   Datos
   --------------------------------------------------------------------------- */
let pollTimer = null;

async function loadRates() {
  clearTimeout(pollTimer);
  try {
    const data = await getRates();
    const previous = state.data;
    state.data = data;
    state.connectionError = false;
    state.failedPolls = 0;
    renderAll(previous);
    handleRunTransition(previous, data);
    maybeLoadHistory();
  } catch (err) {
    state.connectionError = true;
    state.failedPolls += 1;
    renderSync();
    renderAlerts();
  } finally {
    scheduleNextPoll();
  }
}

function nextPollDelay() {
  // Sin conexión: reintentos cada vez más espaciados (5 s, 10 s, 20 s… hasta 60 s), aunque una
  // actualización hubiera quedado "en curso" en los últimos datos recibidos.
  if (state.connectionError) return Math.min(POLL_MS, 5000 * 2 ** (state.failedPolls - 1));
  return state.data?.refresh.running ? POLL_RUNNING_MS : POLL_MS;
}

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  const fast = state.data?.refresh.running && !state.connectionError;
  pollTimer = setTimeout(() => {
    if (document.hidden && !fast) return scheduleNextPoll();
    loadRates();
  }, nextPollDelay());
}

async function maybeLoadHistory() {
  const key = state.data?.refresh.lastRun?.finishedAt ?? 'none';
  if (key === state.historyKey) return;
  state.historyKey = key;
  try {
    const { entries } = await getHistory(30);
    state.history = entries;
  } catch {
    /* el gráfico conserva los datos anteriores */
  }
  renderChart(el.chart, state.history);
}

function handleRunTransition(previous, current) {
  const wasRunning = previous?.refresh.running;
  if (!wasRunning || current.refresh.running) return;
  const run = current.refresh.lastRun;
  if (run && state.manualRefresh) {
    const total = run.ok + run.failed;
    toast(run.failed ? `Actualizado: ${run.ok} de ${total} fuentes respondieron.` : `Cotizaciones actualizadas (${total} fuentes).`, run.failed ? 'i-alert' : 'i-check');
  }
  state.manualRefresh = false;
}

async function onRefreshClick() {
  if (state.data?.refresh.running) return;
  setRefreshBusy(true);
  try {
    await requestRefresh();
    state.manualRefresh = true;
  } catch (err) {
    toast(err.status === 429 ? err.message : 'No se pudo iniciar la actualización. Intenta de nuevo.', 'i-alert');
  }
  await loadRates();
}

/* ---------------------------------------------------------------------------
   Cálculos de presentación
   --------------------------------------------------------------------------- */
function computeRows(list) {
  const { field, better } = OPERATIONS[state.op];
  const rows = list.map((bank) => {
    const price = bank.status === 'unsupported' ? null : bank[field];
    return { ...bank, price, total: price === null ? null : price * state.amount };
  });

  // Las estimaciones se muestran y se comparan, pero no se rankean ni pueden ser "mejor opción".
  const priced = rows
    .filter((r) => r.total !== null && r.status !== 'estimated')
    .sort((a, b) => (better === 'low' ? a.total - b.total : b.total - a.total));
  priced.forEach((row, i) => {
    row.rank = i + 1;
  });
  const best = priced[0]?.total ?? null;
  const worst = priced[priced.length - 1] ?? null;
  for (const row of rows) {
    if (row.total === null || best === null) continue;
    row.isBest = row.status !== 'estimated' && row.total === best;
    row.diffVsBest = Math.abs(row.total - best);
  }
  return { rows, priced, best: priced[0] ?? null, worst };
}

function sortRows(rows, forced) {
  const sort = forced ?? state.sort ?? { key: 'total', dir: OPERATIONS[state.op].better === 'low' ? 'asc' : 'desc' };
  const factor = sort.dir === 'asc' ? 1 : -1;
  const value = (r) => (sort.key === 'name' ? r.name : sort.key === 'total' ? r.total : r[sort.key]);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1; // sin dato siempre al final
    if (vb === null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * factor;
  });
}

/* ---------------------------------------------------------------------------
   Render
   --------------------------------------------------------------------------- */
function renderAll(previous) {
  renderSync();
  renderAlerts();
  renderKpis();
  renderTable(previous);
  renderDigital(previous);
  renderCalculator();
  $('faqInterval').textContent = state.data.refresh.intervalMinutes;
}

function renderSync() {
  const text = el.sync.querySelector('.sync__text');
  const refresh = state.data?.refresh;

  if (state.connectionError) {
    el.sync.dataset.state = 'offline';
    text.textContent = 'Sin conexión con el servidor · reintentando';
  } else if (refresh?.running) {
    el.sync.dataset.state = 'running';
    const p = refresh.progress;
    text.textContent = `Consultando bancos… ${p ? `${p.done} de ${p.total}` : ''}`;
  } else if (refresh?.lastRun) {
    const ageMin = (Date.now() - Date.parse(refresh.lastRun.finishedAt)) / 60000;
    el.sync.dataset.state = ageMin > refresh.intervalMinutes * 2.5 ? 'stale' : 'live';
    const next = refresh.nextRunAt ? ` · próxima ${timeUntil(refresh.nextRunAt)}` : '';
    text.innerHTML = `Actualizado <strong>${relativeTime(refresh.lastRun.finishedAt)}</strong>${next}`;
    el.sync.title = `Última consulta: ${dateTime(refresh.lastRun.finishedAt)}`;
  } else if (refresh) {
    el.sync.dataset.state = 'running';
    text.textContent = 'Preparando la primera consulta…';
  }

  const running = Boolean(refresh?.running);
  setRefreshBusy(running);
  el.progress.hidden = !running;
  if (running && refresh.progress) {
    const pct = Math.max(8, (refresh.progress.done / refresh.progress.total) * 100);
    el.progress.firstElementChild.style.width = `${pct}%`;
  }
}

function setRefreshBusy(busy) {
  el.btnRefresh.disabled = busy;
  el.btnRefresh.setAttribute('aria-busy', String(busy));
  el.btnRefresh.querySelector('.btn__label').textContent = busy ? 'Actualizando…' : 'Actualizar';
}

function renderAlerts() {
  const alerts = [];
  if (state.connectionError) {
    alerts.push({
      kind: 'error',
      text: state.data
        ? 'No pudimos conectar con el servidor. Mostramos los últimos datos cargados.'
        : 'No pudimos conectar con el servidor para obtener las cotizaciones.',
      action: 'Reintentar',
    });
  } else if (state.data) {
    const { summary, refresh } = state.data;
    if (refresh.lastRun && summary.reporting < Math.ceil(summary.total / 2)) {
      alerts.push({
        kind: 'warn',
        text: `Solo ${summary.reporting} de ${summary.total} bancos tienen cotización reciente. Algunos sitios no respondieron.`,
      });
    }
  }
  el.alerts.innerHTML = alerts
    .map(
      (a) => `
      <div class="alert alert--${a.kind}" role="${a.kind === 'error' ? 'alert' : 'status'}">
        <svg class="icon" aria-hidden="true"><use href="#i-alert" /></svg>
        <span>${escapeHtml(a.text)}</span>
        ${a.action ? `<button type="button" data-action="retry">${a.action}</button>` : ''}
      </div>`,
    )
    .join('');
}

const allQuotes = () => [...state.data.banks, ...state.data.digital];

function logoMarkup(q, size = '') {
  // Si la imagen falla, se muestra la sigla (ver listener de "error" en bindEvents).
  return `<span class="logo${size}" data-short="${escapeHtml(q.short)}" aria-hidden="true"><img src="${escapeHtml(q.logo)}" alt="" loading="lazy" decoding="async" /></span>`;
}

function namesWithLogos(ids) {
  const items = ids.map((id) => allQuotes().find((q) => q.id === id)).filter(Boolean);
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  return `<span class="logos">${shown.map((q) => logoMarkup(q, ' logo--xs')).join('')}</span><strong>${escapeHtml(
    shown.map((q) => q.short).join(', '),
  )}${extra > 0 ? ` y ${extra} más` : ''}</strong>`;
}

function renderKpis() {
  const { official, summary } = state.data;
  const value = (v) => (v === null || v === undefined ? '—' : `<small>Bs</small>${rate(v)}`);

  $('kpiOfficial').innerHTML = value(official.value);
  let meta = '';
  if (official.change !== null && official.previousDate) {
    meta = official.change === 0 ? `Sin cambios vs. ${dayLabel(official.previousDate)}` : `${signed(official.change)} vs. ${dayLabel(official.previousDate)}`;
  } else if (official.updatedAt) {
    meta = `Consultado ${relativeTime(official.updatedAt)}`;
  }
  if (official.source === 'banks') meta += ' · según los bancos';
  $('kpiOfficialMeta').textContent = meta || ' ';

  const best = (entry) =>
    entry
      ? `${namesWithLogos(entry.banks)}${official.value ? `<span>${signed(entry.value - official.value)} vs. oficial</span>` : ''}`
      : 'Sin datos';

  $('kpiBestSell').innerHTML = value(summary.bestSell?.value);
  $('kpiBestSellMeta').innerHTML = best(summary.bestSell);
  $('kpiBestBuy').innerHTML = value(summary.bestBuy?.value);
  $('kpiBestBuyMeta').innerHTML = best(summary.bestBuy);

  $('kpiSpread').innerHTML = value(summary.avgSpread);
  $('kpiSpreadMeta').textContent =
    summary.avgBuy !== null ? `Compra ${rate(summary.avgBuy)} · Venta ${rate(summary.avgSell)} (promedios)` : 'Sin datos';

  // Mejor precio para comprar dólares fuera de los bancos, comparado con el mejor banco.
  const digitalBest = state.data.digitalSummary.bestSell;
  $('kpiDigital').innerHTML = value(digitalBest?.value);
  $('kpiDigitalMeta').innerHTML = digitalBest
    ? `${namesWithLogos(digitalBest.banks)}${
        summary.bestSell ? `<span>${signed(digitalBest.value - summary.bestSell.value)} vs. mejor banco</span>` : ''
      }`
    : 'Sin datos';
}

function changeMarkup(change) {
  // Por debajo de medio centavo se vería como "▲ 0,00": no se muestra.
  if (change === null || change === undefined || Math.abs(change) < 0.005) return '';
  const arrow = change > 0 ? '▲' : '▼';
  return `<span class="delta" title="Variación respecto al día anterior">${arrow} ${rate(Math.abs(change))}</span>`;
}

function statusMarkup(q) {
  const s = STATUS[q.status] ?? STATUS.unavailable;
  let detail = '';
  if (q.status === 'ok' || q.status === 'estimated') detail = relativeTime(q.updatedAt);
  else if (q.status === 'stale') detail = `Dato de ${relativeTime(q.updatedAt)}`;
  else if (q.status === 'unsupported') detail = q.note ?? '';
  else detail = 'El sitio no respondió';
  const title = q.error ? ` title="${escapeHtml(q.error)}"` : '';
  return `
    <span class="status status--${q.status}"${title}>
      <svg class="icon" aria-hidden="true"><use href="#${s.icon}" /></svg>
      <span>${s.label}<span class="status__time">${escapeHtml(detail)}</span></span>
    </span>`;
}

/** Fila de la tabla (bancos o plataformas digitales). */
function rowMarkup(q, { bestBuy, bestSell, prev }) {
  const op = OPERATIONS[state.op];
  const flash = (field) => (prev && prev[field] !== q[field] ? ' flash' : '');
  const muted = q.status === 'unsupported' || q.status === 'unavailable';
  const approx = q.status === 'estimated' ? '<span class="approx" title="Valor estimado">≈</span>' : '';
  const rateCell = (field, isBest) =>
    q[field] === null || muted
      ? `<span class="rate rate--na">${q.status === 'unsupported' ? '—' : 'No publica'}</span>`
      : `<span class="rate${isBest ? ' rate--best' : ''}">${approx}${rate(q[field])}</span>${changeMarkup(q.change[field])}`;
  const totalCell =
    q.total === null
      ? '<span class="rate rate--na">—</span>'
      : `<span class="total">${approx}${bs(q.total)}</span>${
          q.isBest
            ? '<span class="pill pill--best"><svg class="icon" aria-hidden="true"><use href="#i-award" /></svg>Mejor opción</span>'
            : `<span class="total__diff">${op.better === 'low' ? '+' : '−'}${bs(q.diffVsBest)} vs. mejor</span>`
        }`;
  const note = q.note && q.status !== 'unsupported' ? `<div class="bank__note">${escapeHtml(q.note)}</div>` : '';
  const asset = q.asset !== 'USD' ? `<span class="tag" title="Stablecoin atada al dólar">${escapeHtml(q.asset)}</span>` : '';

  return `
    <tr class="${q.isBest ? 'row--best' : ''}${muted ? ' row--muted' : ''}${approx ? ' row--estimated' : ''}">
      <td class="col-bank">
        <div class="bank">
          <span class="bank__rank">${q.rank ?? ''}</span>
          ${logoMarkup(q)}
          <div>
            <div class="bank__name">
              <a href="${escapeHtml(q.url)}" target="_blank" rel="noopener">${escapeHtml(q.name)}<svg class="icon" aria-hidden="true"><use href="#i-external" /></svg><span class="visually-hidden"> (abre su sitio web)</span></a>${asset}
            </div>
            ${note}
          </div>
        </div>
      </td>
      <td class="num${flash('buy')}" data-label="Compra (te pagan)">${rateCell('buy', q.buy !== null && q.buy === bestBuy && q.status === 'ok')}</td>
      <td class="num${flash('sell')}" data-label="Venta (te cobran)">${rateCell('sell', q.sell !== null && q.sell === bestSell && q.status === 'ok')}</td>
      <td class="num col-total" data-label="${op.totalLabel} por ${usd(state.amount)}">${totalCell}</td>
      <td class="col-status">${statusMarkup(q)}</td>
    </tr>`;
}

function renderTable(previous) {
  const op = OPERATIONS[state.op];
  const { rows, priced } = computeRows(state.data.banks);
  const query = state.query.trim().toLowerCase();
  const visible = sortRows(rows).filter((r) => !query || r.name.toLowerCase().includes(query) || r.short.toLowerCase().includes(query));
  const prevById = new Map((previous?.banks ?? []).map((b) => [b.id, b]));
  const ctx = { bestSell: state.data.summary.bestSell?.value, bestBuy: state.data.summary.bestBuy?.value };

  document.querySelectorAll('.js-total-header').forEach((n) => (n.textContent = op.totalLabel));
  document.querySelectorAll('.js-total-hint').forEach((n) => (n.textContent = `por ${usd(state.amount)}`));
  $('comparatorSubtitle').textContent =
    state.sort === null
      ? `Ordenado por ${op.better === 'low' ? 'el menor costo' : 'el mayor monto'} para ${state.op === 'buyUsd' ? 'comprar' : 'vender'} ${usd(state.amount)}`
      : `${priced.length} bancos con cotización disponible`;

  el.tbody.innerHTML = visible.map((q) => rowMarkup(q, { ...ctx, prev: prevById.get(q.id) })).join('');
  el.empty.hidden = visible.length > 0;
  $('emptyQuery').textContent = state.query;
  renderSortIndicators();
}

function renderDigital(previous) {
  const op = OPERATIONS[state.op];
  const { rows, best } = computeRows(state.data.digital);
  const sorted = sortRows(rows, { key: 'total', dir: op.better === 'low' ? 'asc' : 'desc' });
  const prevById = new Map((previous?.digital ?? []).map((q) => [q.id, q]));
  const { digitalSummary } = state.data;
  const ctx = { bestSell: digitalSummary.bestSell?.value, bestBuy: digitalSummary.bestBuy?.value };
  el.digitalBody.innerHTML = sorted.map((q) => rowMarkup(q, { ...ctx, prev: prevById.get(q.id) })).join('');

  // Comparación directa con el mejor banco para la misma operación.
  const bankBest = computeRows(state.data.banks).best;
  const subtitle = $('digitalSubtitle');
  if (best && bankBest) {
    const diff = best.total - bankBest.total;
    const favorable = op.better === 'low' ? diff < 0 : diff > 0;
    const verb = state.op === 'buyUsd' ? 'comprar' : 'vender';
    const word = op.better === 'low' ? (diff < 0 ? 'menos' : 'más') : diff > 0 ? 'más' : 'menos';
    subtitle.innerHTML =
      Math.abs(diff) < 0.005
        ? `${escapeHtml(best.name)} iguala al mejor banco para ${verb} ${usd(state.amount)}.`
        : `Con ${escapeHtml(best.name)} ${state.op === 'buyUsd' ? 'pagas' : 'recibes'} <strong class="${favorable ? 'is-good' : 'is-bad'}">${bs(
            Math.abs(diff),
          )} ${word}</strong> que en el mejor banco (${escapeHtml(bankBest.short)}) para ${verb} ${usd(state.amount)}.`;
  } else {
    subtitle.textContent = 'USDT, billeteras y cuentas digitales en dólares';
  }
}

function renderSortIndicators() {
  const active = state.sort ?? { key: 'total', dir: OPERATIONS[state.op].better === 'low' ? 'asc' : 'desc' };
  document.querySelectorAll('.sort').forEach((btn) => {
    const th = btn.closest('th');
    const isActive = btn.dataset.sort === active.key;
    if (isActive) th.setAttribute('aria-sort', active.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    btn.querySelector('use').setAttribute('href', isActive ? (active.dir === 'asc' ? '#i-sort-asc' : '#i-sort-desc') : '#i-sort');
  });
}

function renderCalculator() {
  const op = OPERATIONS[state.op];
  const { best, worst } = computeRows(state.data.banks);
  const digitalBest = computeRows(state.data.digital).best;
  const official = state.data.official.value;

  $('calcResultLabel').textContent = op.resultLabel;
  $('calcWorstLabel').textContent = op.worstLabel;
  $('calcResultValue').textContent = best ? bs(best.total) : '—';
  $('calcResultBank').innerHTML = best
    ? `${logoMarkup(best, ' logo--xs')}<span>en ${escapeHtml(best.name)} (${op.field === 'sell' ? 'venta' : 'compra'} ${rate(best.price)})</span>`
    : 'No hay cotizaciones disponibles';
  $('calcOfficial').textContent = official ? bs(official * state.amount) : '—';
  $('calcWorst').textContent = worst ? `${bs(worst.total)} · ${worst.short}` : '—';
  $('calcDigital').textContent = digitalBest ? `${bs(digitalBest.total)} · ${digitalBest.name}` : '—';

  const saving = best && worst ? Math.abs(worst.total - best.total) : 0;
  const savingEl = $('calcSaving');
  savingEl.hidden = saving < 0.005;
  savingEl.textContent =
    state.op === 'buyUsd'
      ? `Ahorras ${bs(saving)} frente a la opción más cara.`
      : `Recibes ${bs(saving)} más que en la opción menos conveniente.`;

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.amount) === state.amount));
  });
}

/* ---------------------------------------------------------------------------
   Interacción
   --------------------------------------------------------------------------- */
function toast(message, icon = 'i-info') {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${icon}" /></svg><span>${escapeHtml(message)}</span>`;
  el.toasts.append(node);
  setTimeout(() => node.remove(), 5000);
}

function effectiveTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeButton() {
  const next = effectiveTheme() === 'dark' ? 'claro' : 'oscuro';
  el.btnTheme.setAttribute('aria-label', `Cambiar a tema ${next}`);
  el.btnTheme.title = `Tema ${next}`;
}

function setAmount(value, { fromInput = false } = {}) {
  const amount = parseAmount(value);
  const wrapper = el.amount.closest('.input-affix');
  const help = $('amountHelp');
  if (amount === null) {
    wrapper.dataset.invalid = 'true';
    el.amount.setAttribute('aria-invalid', 'true');
    help.textContent = 'Ingresa un monto mayor a cero, por ejemplo 250 o 1.500,50.';
    return;
  }
  wrapper.dataset.invalid = 'false';
  el.amount.removeAttribute('aria-invalid');
  help.textContent = 'La tabla se ordena según tu operación.';
  state.amount = amount;
  if (!fromInput) el.amount.value = formatAmount(amount);
  store.set('calc', { op: state.op, amount: state.amount });
  if (state.data) {
    renderTable();
    renderDigital();
    renderCalculator();
  }
}

function bindEvents() {
  el.btnRefresh.addEventListener('click', onRefreshClick);

  el.btnTheme.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* sin almacenamiento */
    }
    syncThemeButton();
  });

  // Si un logo no carga, se reemplaza por la sigla de la entidad.
  document.addEventListener(
    'error',
    (ev) => {
      const box = ev.target.tagName === 'IMG' ? ev.target.closest('.logo') : null;
      if (!box) return;
      box.textContent = box.dataset.short;
      box.classList.add('logo--text');
    },
    true,
  );

  el.alerts.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-action="retry"]')) loadRates();
  });

  el.search.addEventListener('input', () => {
    state.query = el.search.value;
    if (state.data) renderTable();
  });

  document.querySelectorAll('input[name="op"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      state.op = radio.value;
      state.sort = null;
      store.set('calc', { op: state.op, amount: state.amount });
      if (state.data) {
        renderTable();
        renderDigital();
        renderCalculator();
      }
    }),
  );

  el.amount.addEventListener('input', () => setAmount(el.amount.value, { fromInput: true }));
  el.amount.addEventListener('blur', () => {
    if (parseAmount(el.amount.value) !== null) setAmount(el.amount.value);
  });
  document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => setAmount(chip.dataset.amount)));

  document.querySelectorAll('.sort').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      const current = state.sort ?? { key: 'total', dir: OPERATIONS[state.op].better === 'low' ? 'asc' : 'desc' };
      // Primer clic: la dirección más útil para cada columna.
      const defaults = { name: 'asc', buy: 'desc', sell: 'asc', total: OPERATIONS[state.op].better === 'low' ? 'asc' : 'desc' };
      const dir = current.key === key ? (current.dir === 'asc' ? 'desc' : 'asc') : defaults[key];
      state.sort = { key, dir };
      if (state.data) renderTable();
    }),
  );

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadRates();
  });
  window.addEventListener('online', loadRates);

  // Redibuja el gráfico solo cuando cambia el ancho disponible.
  let resizeFrame;
  let chartWidth = el.chart.clientWidth;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === chartWidth) return;
    chartWidth = width;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (state.historyKey) renderChart(el.chart, state.history);
    });
  }).observe(el.chart);

  // Mantiene vigentes los textos relativos ("hace 3 min") sin pedir datos.
  setInterval(() => {
    if (!state.data || document.hidden) return;
    renderSync();
    renderKpis();
    renderTable();
    renderDigital();
  }, STATUS_TICK_MS);
}

function restorePreferences() {
  const saved = store.get('calc');
  if (saved?.op in OPERATIONS) {
    state.op = saved.op;
    document.querySelector(`input[name="op"][value="${saved.op}"]`).checked = true;
  }
  if (typeof saved?.amount === 'number' && saved.amount > 0) state.amount = saved.amount;
  el.amount.value = formatAmount(state.amount);
}

restorePreferences();
syncThemeButton();
bindEvents();
loadRates();
