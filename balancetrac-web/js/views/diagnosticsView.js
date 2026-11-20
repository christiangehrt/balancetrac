/**
 * diagnosticsView.js – Live-Sensor-Diagnose (Phase-1-PoC)
 *  - Roll / Pitch / Yaw live (relativ, normiert, absolut) und Rohdaten α/β/γ
 *  - Interaktiver Bull's-Eye-Test auf HiDPI-Canvas (requestAnimationFrame + Delta-Time)
 *  - Schnellzugriff: Nullpunkt, Sensor-Freigabe, Simulator, Achsen-Invertierung, EMA-Glättung
 */

import { readScreenAngle, SENSOR_SOURCE, SENSOR_STATUS } from '../sensor.js';
import { createHiDpiCanvas, drawBall, drawCountdown, drawNotice, drawRings, drawToleranceCircle } from './canvasKit.js';
import {
  createToggle,
  createTopBar,
  formatClock,
  formatDeg,
  formatNumber,
  formatSigned,
  fullscreenButton,
  h,
  iconButton,
  setText,
} from './ui.js';

const TEST_DURATION_SEC = 30;
const COUNTDOWN_SEC = 3;
const TRAIL_LENGTH = 48;
const MAX_FRAME_DT = 0.1;

const STATUS_TONE = Object.freeze({
  [SENSOR_STATUS.ACTIVE]: 'ok',
  [SENSOR_STATUS.WAITING]: 'neutral',
  [SENSOR_STATUS.IDLE]: 'neutral',
  [SENSOR_STATUS.NEEDS_PERMISSION]: 'warn',
  [SENSOR_STATUS.DENIED]: 'warn',
  [SENSOR_STATUS.UNSUPPORTED]: 'warn',
  [SENSOR_STATUS.INSECURE]: 'warn',
  [SENSOR_STATUS.NO_DATA]: 'warn',
});

const ACTIVATABLE_STATUSES = new Set([
  SENSOR_STATUS.IDLE,
  SENSOR_STATUS.NEEDS_PERMISSION,
  SENSOR_STATUS.DENIED,
  SENSOR_STATUS.NO_DATA,
  SENSOR_STATUS.INSECURE,
]);

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createDiagnosticsView(ctx) {
  const { t, settings, sensor, wakeLock, actions } = ctx;
  const startSettings = settings.get();
  const level = startSettings.lastLevel;
  const cleanups = [];

  // ---- Top-Bar --------------------------------------------------------------------------
  const topBar = createTopBar({
    title: t('diag.title'),
    subtitle: t('diag.context', { mode: t(`mode.${startSettings.lastMode}`), level }),
    menuLabel: t('topbar.menu'),
    onMenu: () => actions.openMenu(),
    actions: [
      iconButton({ icon: 'calibrate', label: t('topbar.calibrate'), onClick: () => actions.calibrate() }),
      fullscreenButton(t('topbar.fullscreen'), () => actions.toggleFullscreen()),
    ],
    back: { label: t('common.goBack'), onClick: () => actions.goBack() },
  });

  // ---- Canvas ---------------------------------------------------------------------------
  const canvasCard = h(
    'div',
    { class: 'card diag-canvas-card' },
    h('span', { class: 'level-badge', 'aria-hidden': 'true', text: `L${level}` }),
  );
  const stage = createHiDpiCanvas(canvasCard, { className: 'diag-canvas', label: t('diag.canvasLabel') });
  cleanups.push(() => stage.destroy());

  // ---- Status-Chips ---------------------------------------------------------------------
  const chipSource = createChip(t('diag.source'));
  const chipStatus = createChip(t('diag.status'));
  const chipScreen = createChip(t('diag.screenAngle'));
  const chipWake = createChip(t('diag.wakeLock'));
  const chipRow = h('div', { class: 'chip-row' }, chipSource.el, chipStatus.el, chipScreen.el, chipWake.el);

  // ---- Achsen ---------------------------------------------------------------------------
  const rollRow = createAxisRow(t('diag.roll'));
  const pitchRow = createAxisRow(t('diag.pitch'));
  const yawRow = createAxisRow(t('diag.yaw'));
  const axisCard = h('section', { class: 'card axis-list' }, rollRow.el, pitchRow.el, yawRow.el);

  // ---- Bull's-Eye-Test ------------------------------------------------------------------
  const testButton = h('button', { type: 'button', class: 'btn btn-primary' });
  const testInfo = h('p', { class: 'test-info' });
  const statIn = h('span', { class: 'hud' });
  const statDev = h('span', { class: 'hud' });
  const statTime = h('span', { class: 'hud' });
  const testCard = h(
    'section',
    { class: 'card test-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: t('diag.test.title') }), testButton),
    testInfo,
    h(
      'div',
      { class: 'test-stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: t('diag.test.inTarget') }), statIn),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: t('diag.test.deviation') }), statDev),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: t('diag.test.time') }), statTime),
    ),
  );

  const test = {
    phase: 'idle', // idle | countdown | running | done
    countdown: 0,
    remaining: TEST_DURATION_SEC,
    inTime: 0,
    totalTime: 0,
    deviationSum: 0,
    calibrated: false,
  };

  testButton.addEventListener('click', () => {
    if (test.phase === 'countdown' || test.phase === 'running') stopTest();
    else startTest();
  });

  function startTest() {
    Object.assign(test, {
      phase: 'countdown',
      countdown: COUNTDOWN_SEC,
      remaining: TEST_DURATION_SEC,
      inTime: 0,
      totalTime: 0,
      deviationSum: 0,
      calibrated: false,
    });
    renderTestControls();
  }

  function stopTest() {
    Object.assign(test, { phase: 'idle', countdown: 0, remaining: TEST_DURATION_SEC, inTime: 0, totalTime: 0, deviationSum: 0 });
    renderTestControls();
  }

  function testPercent() {
    return test.totalTime > 0 ? Math.round((test.inTime / test.totalTime) * 100) : 0;
  }

  function renderTestControls() {
    switch (test.phase) {
      case 'countdown':
        testButton.textContent = t('diag.test.stop');
        testInfo.textContent = t('diag.test.countdown');
        break;
      case 'running':
        testButton.textContent = t('diag.test.stop');
        testInfo.textContent = t('diag.test.running');
        break;
      case 'done':
        testButton.textContent = t('diag.test.restart');
        testInfo.textContent = t('diag.test.done', { pct: t('diag.percent', { value: testPercent() }) });
        break;
      default:
        testButton.textContent = t('diag.test.start');
        testInfo.textContent = t('diag.test.idle');
    }
  }

  function updateTest(dt, tilt, levelConfig) {
    if (test.phase === 'countdown') {
      test.countdown -= dt;
      // Auto-Kalibrierung in der letzten Countdown-Sekunde
      if (!test.calibrated && test.countdown <= 1) {
        sensor.calibrateZero();
        test.calibrated = true;
      }
      if (test.countdown <= 0) {
        test.phase = 'running';
        renderTestControls();
      }
    } else if (test.phase === 'running') {
      const step = Math.min(dt, test.remaining);
      const distance = Math.hypot(tilt.x, tilt.y);
      test.totalTime += step;
      test.deviationSum += distance * step;
      if (distance <= levelConfig.toleranceRadius) test.inTime += step;
      test.remaining -= dt;
      if (test.remaining <= 0) {
        test.remaining = 0;
        test.phase = 'done';
        renderTestControls();
      }
    }

    const deviationDeg = test.totalTime > 0 ? (test.deviationSum / test.totalTime) * levelConfig.maxTiltDeg : 0;
    setText(statIn, t('diag.percent', { value: testPercent() }));
    setText(statDev, `${formatNumber(deviationDeg, 1)}°`);
    setText(statTime, formatClock(Math.ceil(test.remaining)));
  }

  // ---- Steuerung ------------------------------------------------------------------------
  const calibrateButton = h(
    'button',
    { type: 'button', class: 'btn', on: { click: () => actions.calibrate() } },
    t('diag.calibrate'),
  );
  const activateButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary', on: { click: () => actions.requestSensors() } },
    t('diag.activate'),
  );
  const simToggle = createToggle({
    label: t('diag.simulator'),
    checked: startSettings.simulatorEnabled,
    onChange: (on) => actions.setSimulator(on),
  });
  const invertXToggle = createToggle({
    label: t('diag.invertX'),
    checked: startSettings.invertX,
    onChange: (on) => settings.update({ invertX: on }),
  });
  const invertYToggle = createToggle({
    label: t('diag.invertY'),
    checked: startSettings.invertY,
    onChange: (on) => settings.update({ invertY: on }),
  });
  const invertYawToggle = createToggle({
    label: t('diag.invertYaw'),
    checked: startSettings.invertYaw,
    onChange: (on) => settings.update({ invertYaw: on }),
  });

  const emaValue = h('output', { class: 'range-value' });
  const emaInput = h('input', { type: 'range', min: '5', max: '100', step: '5', 'aria-label': t('diag.smoothing') });
  emaInput.value = String(Math.round(startSettings.emaAlpha * 100));
  emaValue.textContent = formatNumber(startSettings.emaAlpha, 2);
  emaInput.addEventListener('input', () => {
    settings.update({ emaAlpha: Number(emaInput.value) / 100 });
  });

  const controlsCard = h(
    'section',
    { class: 'card controls-card' },
    h('div', { class: 'btn-row' }, calibrateButton, activateButton),
    h('div', { class: 'toggle-grid' }, simToggle.el, invertXToggle.el, invertYToggle.el, invertYawToggle.el),
    h(
      'label',
      { class: 'range-field' },
      h('span', { class: 'range-head' }, h('span', { text: t('diag.smoothing') }), emaValue),
      emaInput,
    ),
  );

  // ---- Details --------------------------------------------------------------------------
  const rawValue = h('dd');
  const zeroValue = h('dd');
  const levelValue = h('dd');
  const toleranceValue = h('dd');
  const infoCard = h(
    'section',
    { class: 'card info-card' },
    h('h2', { class: 'card-title', text: t('diag.info.title') }),
    h(
      'dl',
      { class: 'info-list' },
      h('dt', { text: t('diag.info.raw') }),
      rawValue,
      h('dt', { text: t('diag.info.zero') }),
      zeroValue,
      h('dt', { text: t('diag.info.level') }),
      levelValue,
      h('dt', { text: t('diag.info.tolerance') }),
      toleranceValue,
    ),
  );

  const panel = h('div', { class: 'diag-panel' }, chipRow, axisCard, testCard, controlsCard, infoCard);
  const el = h('section', { class: 'view view-diagnostics' }, topBar, h('div', { class: 'diag-main' }, canvasCard, panel));

  // ---- Status & Settings synchron halten -----------------------------------------------
  function updateStatus() {
    const source = sensor.getSource();
    const status = sensor.getStatus();
    chipSource.set(t(`diag.source.${source}`), source === SENSOR_SOURCE.SIMULATOR ? 'warn' : 'neutral');
    chipStatus.set(t(`diag.status.${status}`), STATUS_TONE[status] ?? 'neutral');
    activateButton.hidden = !(source === SENSOR_SOURCE.DEVICE && ACTIVATABLE_STATUSES.has(status));
  }

  function updateWakeLock(state) {
    chipWake.set(t(`diag.wakeLock.${state}`), state === 'active' ? 'ok' : 'neutral');
  }

  cleanups.push(sensor.onStatusChange(updateStatus));
  cleanups.push(wakeLock.onChange(updateWakeLock));
  cleanups.push(
    settings.subscribe((next) => {
      simToggle.set(next.simulatorEnabled);
      invertXToggle.set(next.invertX);
      invertYToggle.set(next.invertY);
      invertYawToggle.set(next.invertYaw);
      setText(emaValue, formatNumber(next.emaAlpha, 2));
      if (document.activeElement !== emaInput) emaInput.value = String(Math.round(next.emaAlpha * 100));
      updateStatus();
    }),
  );

  updateStatus();
  updateWakeLock(wakeLock.getState());
  renderTestControls();

  // ---- Render-Schleife ------------------------------------------------------------------
  const trail = [];
  let rafId = 0;
  let lastTime = 0;

  function frame(now) {
    const dt = lastTime ? Math.min(MAX_FRAME_DT, (now - lastTime) / 1000) : 0;
    lastTime = now;

    const tilt = sensor.getTilt();
    const raw = sensor.getRaw();
    const levelConfig = ctx.getLevelConfig();

    rollRow.update(tilt.rawRoll, tilt.x, formatDeg(tilt.absRoll));
    pitchRow.update(tilt.rawPitch, tilt.y, formatDeg(tilt.absPitch));
    yawRow.update(tilt.rawYaw, tilt.yaw, `${formatNumber(tilt.absYaw, 1)}°`);

    setText(chipScreen.value, `${readScreenAngle()}°`);
    setText(
      rawValue,
      raw ? `${formatNumber(raw.alpha, 1)} / ${formatSigned(raw.beta)} / ${formatSigned(raw.gamma)}` : '–',
    );
    const zero = sensor.getZero();
    setText(zeroValue, `${formatDeg(zero.rollDeg)} / ${formatDeg(zero.pitchDeg)}`);
    setText(levelValue, t('diag.info.levelValue', { tilt: levelConfig.maxTiltDeg, yaw: levelConfig.maxYawDeg }));
    setText(toleranceValue, formatNumber(levelConfig.toleranceRadius, 2));

    updateTest(dt, tilt, levelConfig);

    trail.push({ x: tilt.x, y: tilt.y });
    if (trail.length > TRAIL_LENGTH) trail.shift();

    if (stage.beginFrame()) {
      drawBullseye(stage.ctx, stage.width, stage.height, {
        tilt,
        tolerance: levelConfig.toleranceRadius,
        trail,
        inTarget: Math.hypot(tilt.x, tilt.y) <= levelConfig.toleranceRadius,
        countdown: test.phase === 'countdown' ? Math.max(1, Math.ceil(test.countdown)) : 0,
        notice: sensor.isDelivering() ? '' : t(`diag.status.${sensor.getStatus()}`),
      });
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
  cleanups.push(() => cancelAnimationFrame(rafId));

  return {
    el,
    destroy() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

function createChip(label) {
  const value = h('span', { class: 'chip-value' });
  const el = h('span', { class: 'chip', dataset: { tone: 'neutral' } }, h('span', { class: 'chip-label', text: label }), value);
  return {
    el,
    value,
    set(text, tone) {
      setText(value, text);
      if (tone && el.dataset.tone !== tone) el.dataset.tone = tone;
    },
  };
}

function createAxisRow(label) {
  const absolute = h('span', { class: 'axis-abs' });
  const value = h('span', { class: 'axis-value hud' });
  const fill = h('span', { class: 'axis-bar-fill' });
  const el = h(
    'div',
    { class: 'axis-row' },
    h('div', { class: 'axis-head' }, h('span', { class: 'axis-label', text: label }), absolute),
    value,
    h('div', { class: 'axis-bar', 'aria-hidden': 'true' }, fill),
  );
  let lastNormalized = Number.NaN;
  return {
    el,
    update(deg, normalized, absoluteText) {
      setText(value, formatDeg(deg));
      setText(absolute, absoluteText);
      if (normalized !== lastNormalized) {
        lastNormalized = normalized;
        const n = Math.max(-1, Math.min(1, normalized));
        fill.style.left = `${50 + Math.min(0, n) * 50}%`;
        fill.style.width = `${Math.abs(n) * 50}%`;
      }
    },
  };
}

/**
 * Zeichnet Zielscheibe, Toleranzkreis, Yaw-Anzeige, Spur und Kugel.
 * @param {CanvasRenderingContext2D} g
 * @param {number} width   CSS-Pixel
 * @param {number} height  CSS-Pixel
 * @param {{tilt: {x: number, y: number, yaw: number}, tolerance: number, trail: Array<{x: number, y: number}>, inTarget: boolean, countdown: number, notice: string}} state
 */
function drawBullseye(g, width, height, state) {
  const { tilt, tolerance, trail, inTarget, countdown, notice } = state;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(30, Math.min(width, height) / 2 - 32);
  const toScreen = (p) => ({ x: cx + p.x * radius, y: cy - p.y * radius });

  g.save();

  // Yaw-Bogen oberhalb der Zielscheibe (±60° entspricht ±maxYawDeg)
  const arcRadius = radius + 17;
  const span = Math.PI / 3;
  g.lineCap = 'round';
  g.lineWidth = 6;
  g.strokeStyle = '#E2E5EA';
  g.beginPath();
  g.arc(cx, cy, arcRadius, -Math.PI / 2 - span, -Math.PI / 2 + span);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = '#9AA1AB';
  g.beginPath();
  g.moveTo(cx, cy - arcRadius - 8);
  g.lineTo(cx, cy - arcRadius + 8);
  g.stroke();
  const yawAngle = -Math.PI / 2 + Math.max(-1, Math.min(1, tilt.yaw)) * span;
  g.fillStyle = '#B9480F';
  g.beginPath();
  g.arc(cx + Math.cos(yawAngle) * arcRadius, cy + Math.sin(yawAngle) * arcRadius, 8, 0, Math.PI * 2);
  g.fill();

  drawRings(g, cx, cy, radius);
  drawToleranceCircle(g, cx, cy, tolerance * radius);

  // Bewegungsspur
  g.lineWidth = 3;
  for (let i = 1; i < trail.length; i += 1) {
    const a = toScreen(trail[i - 1]);
    const b = toScreen(trail[i]);
    g.strokeStyle = `rgba(242, 101, 34, ${((i / trail.length) * 0.45).toFixed(3)})`;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }

  g.restore();

  const ball = toScreen(tilt);
  drawBall(g, ball.x, ball.y, Math.max(9, radius * 0.08), 'player', { highlight: inTarget });
  if (countdown > 0) drawCountdown(g, cx, cy, radius * 0.34, countdown);
  drawNotice(g, notice, cx, height - 10, Math.max(14, radius * 0.09));
}
