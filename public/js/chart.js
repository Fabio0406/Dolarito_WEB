import { rate, dayLabel, escapeHtml } from './format.js';

const SERIES = [
  { key: 'avgSell', label: 'Venta prom.', className: 'sell', color: 'var(--series-sell)' },
  { key: 'official', label: 'Oficial BCB', className: 'official', color: 'var(--series-official)' },
  { key: 'avgBuy', label: 'Compra prom.', className: 'buy', color: 'var(--series-buy)' },
];
const HEIGHT = 240;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

/** Ticks "redondos" para el eje Y. */
function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function emptyState(container, entries) {
  const days = entries.length;
  container.innerHTML = `
    <div class="chart__empty">
      <div>
        <strong>El historial se está construyendo</strong>
        <p>${days ? 'Ya hay 1 día registrado. ' : ''}El gráfico aparecerá cuando haya al menos dos días de datos.</p>
      </div>
    </div>`;
}

/** Dibuja un gráfico de líneas accesible y liviano (SVG puro, sin dependencias). */
export function renderChart(container, entries) {
  const points = entries.filter((e) => SERIES.some((s) => typeof e[s.key] === 'number'));
  if (points.length < 2) return emptyState(container, points);

  const width = Math.max(container.clientWidth - 24, 280);
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const values = points.flatMap((e) => SERIES.map((s) => e[s.key]).filter((v) => typeof v === 'number'));
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const x = (i) => MARGIN.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => MARGIN.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const path = (key) => {
    let d = '';
    let pen = false;
    points.forEach((e, i) => {
      const v = e[key];
      if (typeof v !== 'number') return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const last = points[points.length - 1];
  const summary = SERIES.map((s) => `${s.label} ${rate(last[s.key])}`).join(', ');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="Evolución de ${points.length} días. Último registro (${dayLabel(last.date)}): ${summary}.">
      <g class="grid">
        ${ticks.map((t) => `<line x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y(t)}" y2="${y(t)}" />`).join('')}
      </g>
      <g class="axis">
        ${ticks.map((t) => `<text x="${MARGIN.left - 8}" y="${y(t) + 4}" text-anchor="end">${rate(t)}</text>`).join('')}
        ${labelIdx
          .map((i) => {
            const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
            return `<text x="${x(i)}" y="${HEIGHT - 6}" text-anchor="${anchor}">${dayLabel(points[i].date)}</text>`;
          })
          .join('')}
      </g>
      ${SERIES.map((s) => `<path class="line line--${s.className}" d="${path(s.key)}" />`).join('')}
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${MARGIN.top}" y2="${MARGIN.top + innerH}" />
        ${SERIES.map((s) => `<circle class="dot" r="4.5" fill="${s.color}" data-key="${s.key}" />`).join('')}
      </g>
      <rect class="hit" x="${MARGIN.left}" y="${MARGIN.top}" width="${innerW}" height="${innerH}" fill="transparent" />
    </svg>
    <div class="chart__tooltip" hidden></div>`;

  const svg = container.querySelector('svg');
  const hover = svg.querySelector('.hover');
  const crosshair = hover.querySelector('.crosshair');
  const tooltip = container.querySelector('.chart__tooltip');

  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - MARGIN.left) / innerW) * (points.length - 1))));
    const e = points[i];
    const cx = x(i);
    hover.setAttribute('visibility', 'visible');
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    hover.querySelectorAll('.dot').forEach((dot) => {
      const v = e[dot.dataset.key];
      dot.setAttribute('visibility', typeof v === 'number' ? 'visible' : 'hidden');
      if (typeof v === 'number') {
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', y(v));
      }
    });
    tooltip.innerHTML =
      `<strong>${escapeHtml(dayLabel(e.date))}</strong>` +
      SERIES.map((s) => `<div><span>${s.label}</span><span>${rate(e[s.key])}</span></div>`).join('');
    tooltip.hidden = false;
    const left = (cx / width) * box.width + 12;
    const flip = left + tooltip.offsetWidth > container.clientWidth;
    tooltip.style.left = `${flip ? left - tooltip.offsetWidth - 24 : left}px`;
  };
  const hide = () => {
    hover.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', (ev) => show(ev.clientX));
  hit.addEventListener('pointerdown', (ev) => show(ev.clientX));
  hit.addEventListener('pointerleave', hide);
}
