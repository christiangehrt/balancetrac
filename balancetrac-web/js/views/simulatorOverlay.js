/**
 * simulatorOverlay.js – Virtueller Sensor für Desktop-Tests
 *  - Verschiebbares, halbtransparentes Overlay mit 2D-Joystick (Roll/Pitch) und Yaw-Slider
 *  - Tastatur: W/A/S/D oder Pfeiltasten (Roll/Pitch), Q/E (Yaw/Twist); C (Nullpunkt) ist global in main.js
 *  - Liefert absolute Board-Winkel an SensorService.ingestSimulated(); Nullpunkt, Invertierung,
 *    EMA und Deadzone laufen dadurch exakt wie beim echten Sensor durch die Pipeline.
 */

import { clamp, normalizeAngle360 } from '../sensorMath.js';
import { uiIcon } from '../icons.js';
import { formatDeg, h, iconButton, isEditableTarget, setText } from './ui.js';

/** Basis-Kurs nahe der 0°/360°-Grenze, damit die Wrap-around-Sicherheit beim Twisten mitgetestet wird. */
export const SIM_YAW_BASE_DEG = 355;
/** Voller Joystick-Ausschlag = 115 % des Level-Maximums (Clamping wird sichtbar). */
const TILT_OVERDRIVE = 1.15;
const KEY_RAMP_PER_SEC = 4.5;
const SPRING_RATE_PER_SEC = 7;
const YAW_KEY_RATE_PER_SEC = 1.25;
const MAX_FRAME_DT = 0.05;

const KEY_BINDINGS = Object.freeze({
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyQ: 'yawLeft',
  KeyE: 'yawRight',
});

const ARROW_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function approach(value, target, maxStep) {
  return value + clamp(target - value, -maxStep, maxStep);
}

/**
 * @param {{
 *   t: (key: string, params?: object) => string,
 *   sensor: import('../sensor.js').SensorService,
 *   getLevelConfig: () => {maxTiltDeg: number, maxYawDeg: number},
 *   onCalibrate: () => void,
 *   onClose: () => void,
 * }} options
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createSimulatorOverlay({ t, sensor, getLevelConfig, onCalibrate, onClose }) {
  const pressed = new Set();
  let jx = 0; // -1 links … +1 rechts
  let jy = 0; // -1 hinten … +1 vorne
  let yawNorm = 0; // -1 … +1
  let dragPointerId = null;
  let dragTarget = { x: 0, y: 0 };
  let moveState = null;
  let rafId = 0;
  let lastTime = 0;

  // ---- DOM ------------------------------------------------------------------------------
  const knob = h('div', { class: 'sim-knob' });
  const joystick = h('div', { class: 'sim-joystick', 'aria-label': t('sim.joystick'), title: t('sim.joystick') }, knob);

  const yawValue = h('output', { class: 'sim-yaw-value' }, formatDeg(0));
  const yawSlider = h('input', { type: 'range', min: '-100', max: '100', step: '1', 'aria-label': t('sim.yaw') });
  yawSlider.value = '0';
  yawSlider.addEventListener('input', () => {
    yawNorm = clamp(Number(yawSlider.value) / 100, -1, 1);
  });

  const centerButton = h('button', { type: 'button', class: 'btn' }, t('sim.center'));
  centerButton.addEventListener('click', () => {
    jx = 0;
    jy = 0;
    yawNorm = 0;
    yawSlider.value = '0';
  });
  const calibrateButton = h('button', { type: 'button', class: 'btn' }, t('sim.calibrate'));
  calibrateButton.addEventListener('click', () => onCalibrate());

  const readout = h('div', { class: 'sim-readout' });
  const closeButton = iconButton({ icon: 'close', label: t('sim.close'), onClick: () => onClose() });
  const collapseButton = iconButton({
    icon: 'minus',
    label: t('sim.collapse'),
    pressed: false,
    onClick: () => setCollapsed(!el.classList.contains('is-collapsed')),
  });
  const header = h(
    'div',
    { class: 'sim-header', title: t('sim.drag') },
    h('span', { class: 'sim-title' }, h('span', { html: uiIcon('joystick') }), t('sim.title')),
    h('span', { class: 'sim-header-actions' }, collapseButton, closeButton),
  );

  const body = h(
    'div',
    { class: 'sim-body' },
    joystick,
    h('div', { class: 'sim-yaw-head' }, h('span', { text: t('sim.yaw') }), yawValue),
    yawSlider,
    h('div', { class: 'sim-actions' }, centerButton, calibrateButton),
    readout,
    h('p', { class: 'sim-keys', text: t('sim.keys') }),
  );

  const el = h('div', { class: 'sim-overlay', role: 'group', 'aria-label': t('sim.title') }, header, body);

  /** Minimiert das Overlay auf die Kopfzeile; Tastatursteuerung bleibt aktiv. */
  function setCollapsed(collapsed) {
    el.classList.toggle('is-collapsed', collapsed);
    collapseButton.innerHTML = uiIcon(collapsed ? 'plus' : 'minus');
    const label = t(collapsed ? 'sim.expand' : 'sim.collapse');
    collapseButton.setAttribute('aria-label', label);
    collapseButton.title = label;
    collapseButton.setAttribute('aria-pressed', String(collapsed));
  }

  // ---- Joystick per Maus/Touch ----------------------------------------------------------
  function updateDragTarget(event) {
    const rect = joystick.getBoundingClientRect();
    const r = rect.width / 2;
    if (r <= 0) return;
    let dx = (event.clientX - (rect.left + r)) / r;
    let dy = (event.clientY - (rect.top + r)) / r;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    dragTarget = { x: dx, y: -dy };
  }

  joystick.addEventListener('pointerdown', (event) => {
    if (dragPointerId !== null) return;
    dragPointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateDragTarget(event);
    event.preventDefault();
  });
  joystick.addEventListener('pointermove', (event) => {
    if (event.pointerId === dragPointerId) updateDragTarget(event);
  });
  const endJoystickDrag = (event) => {
    if (event.pointerId === dragPointerId) dragPointerId = null;
  };
  joystick.addEventListener('pointerup', endJoystickDrag);
  joystick.addEventListener('pointercancel', endJoystickDrag);
  joystick.addEventListener('lostpointercapture', endJoystickDrag);

  // ---- Overlay verschieben --------------------------------------------------------------
  header.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) return;
    const rect = el.getBoundingClientRect();
    moveState = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  header.addEventListener('pointermove', (event) => {
    if (!moveState || event.pointerId !== moveState.pointerId) return;
    const maxX = Math.max(4, window.innerWidth - el.offsetWidth - 4);
    const maxY = Math.max(4, window.innerHeight - el.offsetHeight - 4);
    el.style.left = `${clamp(event.clientX - moveState.dx, 4, maxX)}px`;
    el.style.top = `${clamp(event.clientY - moveState.dy, 4, maxY)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  const endMove = (event) => {
    if (moveState && event.pointerId === moveState.pointerId) moveState = null;
  };
  header.addEventListener('pointerup', endMove);
  header.addEventListener('pointercancel', endMove);

  // ---- Tastatur -------------------------------------------------------------------------
  function onKeyDown(event) {
    const action = KEY_BINDINGS[event.code];
    if (!action || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    // Pfeiltasten auf einem fokussierten Schieberegler bleiben beim Regler
    if (ARROW_CODES.has(event.code) && event.target instanceof HTMLInputElement && event.target.type === 'range') return;
    pressed.add(action);
    event.preventDefault();
  }
  function onKeyUp(event) {
    const action = KEY_BINDINGS[event.code];
    if (action) pressed.delete(action);
  }
  function onBlur() {
    pressed.clear();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ---- Simulationsschleife --------------------------------------------------------------
  function frame(now) {
    const dt = lastTime ? Math.min(MAX_FRAME_DT, (now - lastTime) / 1000) : 0;
    lastTime = now;

    const keyX = (pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0);
    const keyY = (pressed.has('up') ? 1 : 0) - (pressed.has('down') ? 1 : 0);
    if (dragPointerId !== null) {
      jx = dragTarget.x;
      jy = dragTarget.y;
    } else if (keyX !== 0 || keyY !== 0) {
      const length = Math.hypot(keyX, keyY);
      jx = approach(jx, keyX / length, KEY_RAMP_PER_SEC * dt);
      jy = approach(jy, keyY / length, KEY_RAMP_PER_SEC * dt);
    } else {
      // Board federt in die Waagerechte zurück
      const decay = Math.exp(-SPRING_RATE_PER_SEC * dt);
      jx = Math.abs(jx * decay) < 0.002 ? 0 : jx * decay;
      jy = Math.abs(jy * decay) < 0.002 ? 0 : jy * decay;
    }

    const yawKeys = (pressed.has('yawRight') ? 1 : 0) - (pressed.has('yawLeft') ? 1 : 0);
    if (yawKeys !== 0) {
      yawNorm = clamp(yawNorm + yawKeys * YAW_KEY_RATE_PER_SEC * dt, -1, 1);
      yawSlider.value = String(Math.round(yawNorm * 100));
    }

    const levelConfig = getLevelConfig();
    const rollDeg = jx * levelConfig.maxTiltDeg * TILT_OVERDRIVE;
    const pitchDeg = jy * levelConfig.maxTiltDeg * TILT_OVERDRIVE;
    const yawOffsetDeg = yawNorm * levelConfig.maxYawDeg * TILT_OVERDRIVE;
    sensor.ingestSimulated({ rollDeg, pitchDeg, yawDeg: normalizeAngle360(SIM_YAW_BASE_DEG + yawOffsetDeg) });

    const travel = Math.max(0, (joystick.clientWidth - knob.offsetWidth) / 2);
    knob.style.transform = `translate(calc(-50% + ${(jx * travel).toFixed(1)}px), calc(-50% + ${(-jy * travel).toFixed(1)}px))`;
    setText(yawValue, formatDeg(yawOffsetDeg));
    setText(readout, `R ${formatDeg(rollDeg)} · P ${formatDeg(pitchDeg)}`);

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    el,
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.remove();
    },
  };
}
