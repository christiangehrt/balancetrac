/**
 * historyView.js – Modul "History" (Fortschritts-Tracking)
 *  - Top-Bar: ≡, "History", "Go Back"
 *  - Zeitraum-Tabs Day | Week | Month | Year mit Blättern in frühere Zeiträume
 *  - Canvas-Diagramm, Y-Achse fest 0–100: Average (grün), Daily Best (orange),
 *    All Time Best (gelbe gestrichelte Referenzlinie) + Legende
 *  - 3-fach-Filterleiste: Gerät, Aktivität, Level
 */

import { ACTIVITIES, getActivity } from '../activities.js';
import { BOARD_PROFILES, LEVELS } from '../config.js';
import { aggregateHistory, HISTORY_PERIODS, isoWeek } from '../historyAggregator.js';
import { getLanguage } from '../i18n.js';
import { createHiDpiCanvas } from './canvasKit.js';
import { createSegmented, createStepper, createTopBar, h, iconButton, setText } from './ui.js';

const CHART = Object.freeze({
  average: '#4CAF50',
  best: '#F26522',
  allTime: '#E0A800',
  allTimeText: '#8A6A00',
  grid: '#E3E6EA',
  gridStrong: '#C9CED6',
  axisText: '#555C67',
  selection: 'rgba(242, 101, 34, 0.09)',
  empty: '#7A818B',
});
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DAY_MS = 86400000;

/** Filter und Zeitraum bleiben für die laufende Sitzung erhalten. */
const memory = { period: 'WEEK', offset: 0, deviceId: null, activityId: ACTIVITIES[0].id, level: null };

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createHistoryView(ctx) {
  const { t, settings, sessions, actions } = ctx;
  const initial = settings.get();
  const locale = getLanguage() === 'de' ? 'de-DE' : 'en-GB';
  const state = {
    period: memory.period,
    offset: memory.offset,
    deviceId: memory.deviceId ?? initial.boardProfileId,
    activityId: getActivity(memory.activityId) ? memory.activityId : ACTIVITIES[0].id,
    level: memory.level ?? initial.lastLevel,
    selected: -1,
  };
  let aggregation = null;
  let layout = null;

  const formatters = {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    month: new Intl.DateTimeFormat(locale, { month: 'short' }),
    monthLong: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    dayFull: new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
    dayShort: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
    dayWithWeekday: new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }),
  };

  // ---- Top-Bar & Zeitraum ---------------------------------------------------------------
  const topBar = createTopBar({
    title: t('history.title'),
    menuLabel: t('topbar.menu'),
    onMenu: () => actions.openMenu(),
    back: { label: t('common.goBack'), onClick: () => actions.goBack() },
  });

  const periodSegment = createSegmented({
    label: t('history.periodLabel'),
    className: 'segmented-compact history-periods',
    options: HISTORY_PERIODS.map((period) => ({ value: period, label: t(`history.period.${period}`) })),
    value: state.period,
    onChange: (period) => {
      state.period = period;
      state.offset = 0;
      state.selected = -1;
      update();
    },
  });

  const periodLabel = h('span', { class: 'period-label', 'aria-live': 'polite' });
  const prevPeriod = iconButton({
    icon: 'chevronLeft',
    label: t('history.prevPeriod'),
    onClick: () => {
      state.offset -= 1;
      state.selected = -1;
      update();
    },
  });
  const nextPeriod = iconButton({
    icon: 'chevronRight',
    label: t('history.nextPeriod'),
    onClick: () => {
      if (state.offset >= 0) return;
      state.offset += 1;
      state.selected = -1;
      update();
    },
  });
  const toolbar = h(
    'div',
    { class: 'history-toolbar' },
    periodSegment.el,
    h('div', { class: 'period-nav' }, prevPeriod, periodLabel, nextPeriod),
  );

  // ---- Diagramm -------------------------------------------------------------------------
  const legend = h(
    'ul',
    { class: 'history-legend' },
    h('li', null, h('span', { class: 'legend-swatch legend-average' }), t('history.legend.average')),
    h('li', null, h('span', { class: 'legend-swatch legend-best' }), t('history.legend.dailyBest')),
    h('li', null, h('span', { class: 'legend-swatch legend-alltime' }), t('history.legend.allTimeBest')),
  );
  const canvasWrap = h('div', { class: 'history-canvas-wrap' });
  const stage = createHiDpiCanvas(canvasWrap, { className: 'stage-canvas', label: t('history.chartLabel'), onResize: draw });
  const summary = h('p', { class: 'history-summary', 'aria-live': 'polite' });
  const chartCard = h('section', { class: 'card history-chart-card' }, legend, canvasWrap, summary);

  stage.canvas.addEventListener('click', (event) => {
    if (!layout || !aggregation) return;
    const rect = stage.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < layout.x0 || x > layout.x1) return;
    const index = Math.min(layout.n - 1, Math.floor((x - layout.x0) / layout.slot));
    state.selected = state.selected === index ? -1 : index;
    draw();
    renderSummary();
  });

  // ---- Filterleiste ---------------------------------------------------------------------
  const deviceStepper = createStepper({
    label: t('history.filter.device'),
    options: BOARD_PROFILES.map((profile) => ({ value: profile.id, label: t(profile.nameKey) })),
    value: state.deviceId,
    prevLabel: t('history.filter.prev', { filter: t('history.filter.device') }),
    nextLabel: t('history.filter.next', { filter: t('history.filter.device') }),
    onChange: (deviceId) => {
      state.deviceId = deviceId;
      state.selected = -1;
      update();
    },
  });
  const activityStepper = createStepper({
    label: t('history.filter.activity'),
    options: ACTIVITIES.map((activity) => ({ value: activity.id, label: t(activity.nameKey) })),
    value: state.activityId,
    prevLabel: t('history.filter.prev', { filter: t('history.filter.activity') }),
    nextLabel: t('history.filter.next', { filter: t('history.filter.activity') }),
    onChange: (activityId) => {
      state.activityId = activityId;
      state.selected = -1;
      update();
    },
  });
  const levelStepper = createStepper({
    label: t('history.filter.level'),
    options: LEVELS.map((level) => ({ value: level, label: t('history.levelValue', { level }) })),
    value: state.level,
    prevLabel: t('history.filter.prev', { filter: t('history.filter.level') }),
    nextLabel: t('history.filter.next', { filter: t('history.filter.level') }),
    onChange: (level) => {
      state.level = level;
      state.selected = -1;
      update();
    },
  });
  const filters = h('div', { class: 'history-filters' }, deviceStepper.el, activityStepper.el, levelStepper.el);

  const el = h(
    'section',
    { class: 'view view-history' },
    topBar,
    h('div', { class: 'history-main' }, toolbar, chartCard, filters),
  );

  // ---- Logik ----------------------------------------------------------------------------
  function currentFilter() {
    const activity = getActivity(state.activityId);
    return { deviceId: state.deviceId, mode: activity?.mode, activityId: state.activityId, level: state.level };
  }

  function update() {
    Object.assign(memory, {
      period: state.period,
      offset: state.offset,
      deviceId: state.deviceId,
      activityId: state.activityId,
      level: state.level,
    });
    aggregation = aggregateHistory(sessions.getAll(), {
      period: state.period,
      referenceMillis: Date.now(),
      offset: state.offset,
      filter: currentFilter(),
    });
    if (state.selected >= aggregation.buckets.length) state.selected = -1;
    setText(periodLabel, formatPeriod(aggregation));
    nextPeriod.disabled = state.offset >= 0;
    draw();
    renderSummary();
  }

  function formatPeriod(data) {
    switch (data.period) {
      case 'DAY':
        return formatters.dayFull.format(data.start);
      case 'WEEK': {
        const { week } = isoWeek(data.start);
        const range = `${formatters.dayShort.format(data.start)} – ${formatters.dayShort.format(data.end - DAY_MS / 2)}`;
        return t('history.weekLabel', { week, range });
      }
      case 'MONTH':
        return formatters.monthLong.format(data.start);
      default:
        return String(new Date(data.start).getFullYear());
    }
  }

  function bucketAxisLabels(data, slotWidth) {
    return data.buckets.map((bucket, index) => {
      const date = new Date(bucket.start);
      switch (bucket.unit) {
        case 'hour': {
          const every = slotWidth >= 26 ? 2 : slotWidth >= 14 ? 3 : 6;
          return index % every === 0 ? String(date.getHours()) : '';
        }
        case 'month':
          return slotWidth >= 30 ? formatters.month.format(date).replace(/\.$/, '') : String(index + 1);
        default:
          if (data.period === 'WEEK') return formatters.weekday.format(date).replace(/\.$/, '');
          if (slotWidth >= 20) return String(date.getDate());
          return date.getDate() === 1 || date.getDate() % 5 === 0 ? String(date.getDate()) : '';
      }
    });
  }

  function bucketTitle(bucket) {
    const date = new Date(bucket.start);
    switch (bucket.unit) {
      case 'hour': {
        const hour = String(date.getHours()).padStart(2, '0');
        return `${hour}:00–${hour}:59`;
      }
      case 'month':
        return formatters.monthLong.format(date);
      default:
        return formatters.dayWithWeekday.format(date);
    }
  }

  function sessionsLabel(count) {
    return count === 1 ? t('history.sessions.one') : t('history.sessions.other', { count });
  }

  function renderSummary() {
    if (!aggregation) return;
    const bucket = state.selected >= 0 ? aggregation.buckets[state.selected] : null;
    let text;
    if (bucket) {
      text =
        bucket.count > 0
          ? t('history.bucketSummary', {
              label: bucketTitle(bucket),
              avg: Math.round(bucket.average),
              best: bucket.best,
              sessions: sessionsLabel(bucket.count),
            })
          : t('history.bucketEmpty', { label: bucketTitle(bucket) });
    } else if (aggregation.count > 0) {
      text = t('history.summary', {
        avg: Math.round(aggregation.average),
        best: aggregation.best,
        sessions: sessionsLabel(aggregation.count),
      });
    } else {
      text = aggregation.allTimeCount > 0 ? t('history.empty') : t('history.emptyActivity');
    }
    setText(summary, text);
  }

  function draw() {
    if (!aggregation || !stage.beginFrame()) return;
    layout = drawChart(stage.ctx, stage.width, stage.height, aggregation, {
      selected: state.selected,
      axisLabel: t('history.axis'),
      allTimeLabel: t('history.legend.allTimeBest'),
      emptyText: t('history.empty'),
      labelsFor: bucketAxisLabels,
    });
  }

  const unsubscribe = sessions.subscribe(() => update());
  update();

  return {
    el,
    mounted() {
      stage.refresh();
    },
    destroy() {
      unsubscribe();
      stage.destroy();
    },
  };
}

/**
 * Zeichnet das Balkendiagramm und liefert die Geometrie für die Treffer-Erkennung.
 * @param {CanvasRenderingContext2D} g
 * @param {number} width
 * @param {number} height
 * @param {ReturnType<typeof aggregateHistory>} data
 * @param {{selected: number, axisLabel: string, allTimeLabel: string, emptyText: string, labelsFor: (data: object, slot: number) => string[]}} view
 * @returns {{x0: number, x1: number, slot: number, n: number} | null}
 */
function drawChart(g, width, height, data, view) {
  const fontSize = Math.round(Math.min(15, Math.max(11, height * 0.05)));
  const left = fontSize * 3.4;
  const right = 12;
  const top = fontSize * 1.4;
  const bottom = fontSize * 2;
  const x0 = left;
  const x1 = width - right;
  const y0 = top;
  const y1 = height - bottom;
  if (x1 - x0 < 60 || y1 - y0 < 40) return null;
  const yFor = (value) => y1 - (Math.max(0, Math.min(100, value)) / 100) * (y1 - y0);
  const n = data.buckets.length;
  const slot = (x1 - x0) / n;

  g.save();
  g.font = `600 ${fontSize}px ${FONT_STACK}`;

  // Raster mit fester Skala 0–100
  for (const value of [0, 25, 50, 75, 100]) {
    const y = Math.round(yFor(value)) + 0.5;
    const major = value % 50 === 0;
    g.strokeStyle = major ? CHART.gridStrong : CHART.grid;
    g.lineWidth = 1;
    g.setLineDash(major ? [] : [3, 5]);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    if (major) {
      g.fillStyle = CHART.axisText;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(String(value), x0 - 8, y);
    }
  }
  g.setLineDash([]);

  // Achsentitel
  g.save();
  g.translate(fontSize * 0.75, (y0 + y1) / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = CHART.axisText;
  g.fillText(view.axisLabel, 0, 0);
  g.restore();

  // Balken
  const barWidth = Math.max(3, Math.min(slot * 0.62, 56));
  const averageWidth = Math.max(2, barWidth * 0.42);
  const labels = view.labelsFor(data, slot);
  const valueLabels = [];
  data.buckets.forEach((bucket, index) => {
    const cx = x0 + slot * (index + 0.5);
    if (index === view.selected) {
      g.fillStyle = CHART.selection;
      g.fillRect(x0 + slot * index, y0, slot, y1 - y0);
    }
    if (bucket.count > 0) {
      const yBest = yFor(bucket.best);
      drawBar(g, cx - barWidth / 2, yBest, barWidth, y1 - yBest, CHART.best);
      const yAverage = yFor(bucket.average);
      drawBar(g, cx - averageWidth / 2, yAverage, averageWidth, y1 - yAverage, CHART.average);
      if (slot >= 30) valueLabels.push({ x: cx, y: Math.max(y0 + fontSize + 2, yBest - 3), text: String(bucket.best) });
    }
    if (labels[index]) {
      g.fillStyle = CHART.axisText;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(labels[index], cx, y1 + 6);
    }
  });

  // All-Time-Best-Referenzlinie
  if (data.allTimeBest !== null) {
    const y = yFor(data.allTimeBest);
    g.strokeStyle = CHART.allTime;
    g.lineWidth = 2.5;
    g.setLineDash([10, 6]);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.setLineDash([]);
    const text = `${view.allTimeLabel} ${data.allTimeBest}`;
    g.font = `700 ${fontSize}px ${FONT_STACK}`;
    const textWidth = g.measureText(text).width;
    const below = y - fontSize - 6 < 0;
    const ty = below ? y + 4 : y - 4;
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    g.fillRect(x1 - textWidth - 8, below ? ty : ty - fontSize - 2, textWidth + 8, fontSize + 4);
    g.fillStyle = CHART.allTimeText;
    g.textAlign = 'right';
    g.textBaseline = below ? 'top' : 'bottom';
    g.fillText(text, x1 - 4, ty);
  }

  // Werte über den Balken zuletzt (lesbar über der Referenzlinie)
  g.font = `700 ${fontSize}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  for (const label of valueLabels) {
    const w = g.measureText(label.text).width + 6;
    g.fillStyle = 'rgba(255, 255, 255, 0.9)';
    g.fillRect(label.x - w / 2, label.y - fontSize - 1, w, fontSize + 2);
    g.fillStyle = CHART.axisText;
    g.fillText(label.text, label.x, label.y);
  }

  // Leerer Zeitraum
  if (data.count === 0) {
    g.font = `600 ${Math.round(fontSize * 1.15)}px ${FONT_STACK}`;
    g.fillStyle = CHART.empty;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(view.emptyText, (x0 + x1) / 2, (y0 + y1) / 2);
  }

  g.restore();
  return { x0, x1, slot, n };
}

function drawBar(g, x, y, width, height, color) {
  if (height <= 0) return;
  const r = Math.min(4, width / 2, height);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y + height);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.lineTo(x + width - r, y);
  g.quadraticCurveTo(x + width, y, x + width, y + r);
  g.lineTo(x + width, y + height);
  g.closePath();
  g.fill();
}
