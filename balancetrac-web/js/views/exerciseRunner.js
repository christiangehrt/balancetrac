/**
 * exerciseRunner.js – Führt eine einzelne Measure-Übung aus.
 *
 *  - Vorstart: kurze Anleitung + Aufsteig-Countdown; in der letzten Sekunde wird automatisch
 *    calibrateZero() ausgelöst
 *  - Live-HUD (TV-optimiert): Übungsname, Live-Score 0–100, Restzeit, Level-Badge
 *  - Bahnberechnung (exercises.js), Scoring (scoring.js) und Canvas-Rendering mit Delta-Time
 *
 * Wird vom Measure-Modul genutzt und ist für den Train-Zirkel (Phase 5) wiederverwendbar.
 */

import {
  arcPath,
  chasePath,
  createTagSession,
  ORBIT_RADIUS,
  playerPosition,
  targetPosition,
  trackingDistance,
} from '../exercises.js';
import { exercisePictogram } from '../icons.js';
import { createTrackingScorer, tagScore, tagTargetCount } from '../scoring.js';
import { COLORS, createHiDpiCanvas, drawBall, drawNotice, drawRings, drawToleranceCircle, drawTube } from './canvasKit.js';
import { formatClock, h, iconButton, setText } from './ui.js';

const MAX_FRAME_DT = 0.1;
const FINAL_TICK_SECONDS = 3;
const CATCH_FLASH_SEC = 0.4;
const CHASE_PATH = chasePath(240);
const ARC_PATHS = Object.freeze({ front: arcPath('front', 64), rear: arcPath('rear', 64) });

/**
 * @param {{
 *   ctx: object,
 *   exercise: {id: string, kind: string, layout: string, direction?: string, arc?: string},
 *   durationSec: number,
 *   countdownSec: number,
 *   onFinish: (result: object) => void,
 *   onAbort?: (reason: 'user'|'hidden') => void,
 *   prestartLabel?: string,     kleine Zeile über dem Titel der Vorstart-Karte (z. B. "Pause · Als Nächstes")
 *   prestartHint?: string,      Hinweis unter dem Countdown (Standard: Aufsteigen + Kalibrierung)
 *   showPictogram?: boolean,    große Piktogramm-Vorschau auf der Vorstart-Karte (Train-Pausen)
 *   tickMode?: 'all'|'last3',   Countdown-Beep jede Sekunde oder nur 3-2-1
 *   prestartSound?: string,     Sound beim Start des Vorstarts (z. B. 'pause')
 *   announce?: string,          Sprachansage beim Start (Standard: Übungsname)
 *   contextLabel?: string,      Zusatzzeile im HUD (z. B. "Station 3/12")
 *   onStopRequest?: () => void, statt sofort abzubrechen (z. B. Rückfrage im Train-Zirkel)
 * }} options
 * @returns {{el: HTMLElement, start: () => void, abort: (reason?: 'user'|'hidden') => void, readonly phase: string, destroy: () => void}}
 */
export function createExerciseRunner({
  ctx,
  exercise,
  durationSec,
  countdownSec,
  onFinish,
  onAbort,
  prestartLabel,
  prestartHint,
  showPictogram = false,
  tickMode = 'all',
  prestartSound,
  announce,
  contextLabel,
  onStopRequest,
}) {
  const { t, sensor, audio } = ctx;
  const level = ctx.settings.get().lastLevel;
  const name = t(`exercise.${exercise.id}.name`);
  const isTag = exercise.kind === 'tag';
  const tagGoal = isTag ? tagTargetCount(level, durationSec) : 0;

  // ---- DOM ------------------------------------------------------------------------------
  const stageEl = h('div', { class: 'run-stage' });
  const stage = createHiDpiCanvas(stageEl, { className: 'stage-canvas', label: name });

  const scoreEl = h('div', { class: 'hud-score hud' }, '0');
  const timeEl = h('div', { class: 'hud-time hud' }, formatClock(durationSec));
  const extraEl = h('div', { class: 'hud-extra' });
  extraEl.hidden = !isTag;
  const hud = h(
    'div',
    { class: 'run-hud' },
    scoreEl,
    h(
      'div',
      { class: 'hud-title' },
      h('span', { text: name }),
      contextLabel ? h('span', { class: 'hud-context', text: contextLabel }) : null,
    ),
    timeEl,
    extraEl,
    h('div', { class: 'hud-level', text: `L${level}` }),
    iconButton({
      icon: 'close',
      label: t('measure.stop'),
      className: 'hud-stop',
      onClick: () => (onStopRequest ? onStopRequest() : abort('user')),
    }),
  );

  const countEl = h('div', { class: 'prestart-count', 'aria-live': 'assertive' }, String(Math.ceil(countdownSec)));
  const prestartEl = h(
    'div',
    { class: `prestart${showPictogram ? ' prestart-preview' : ''}` },
    h(
      'div',
      { class: 'prestart-card' },
      prestartLabel ? h('p', { class: 'prestart-label', text: prestartLabel }) : null,
      h('h2', { class: 'prestart-title', text: name }),
      showPictogram ? h('div', { class: 'prestart-picto', 'aria-hidden': 'true', html: exercisePictogram(exercise.id) }) : null,
      h('p', { class: 'prestart-text', text: t(`exercise.${exercise.id}.instruction`) }),
      countEl,
      h('p', { class: 'prestart-hint', text: prestartHint ?? t('measure.getReady') }),
    ),
  );

  const el = h('section', { class: 'run-view', 'aria-label': name }, stageEl, hud, prestartEl);

  // ---- Zustand --------------------------------------------------------------------------
  let phase = 'idle'; // idle | countdown | running | finished | aborted
  let countdownLeft = Math.max(1, countdownSec);
  let lastCountShown = null;
  let calibrated = false;
  let elapsed = 0;
  let lastTickSecond = null;
  let catchFlash = 0;
  let rafId = 0;
  let lastTime = 0;
  const scorer = createTrackingScorer();
  const tag = isTag ? createTagSession({ toleranceRadius: ctx.getLevelConfig().toleranceRadius, seed: Date.now() }) : null;

  function currentScore() {
    return isTag ? tagScore(tag.caught, level, durationSec) : scorer.score;
  }

  function updateHud(remaining) {
    setText(scoreEl, String(currentScore()));
    setText(timeEl, formatClock(Math.ceil(Math.max(0, remaining))));
    if (isTag) setText(extraEl, t('measure.tagProgress', { caught: tag.caught, target: tagGoal }));
  }

  function frame(now) {
    const dt = lastTime ? Math.min(MAX_FRAME_DT, (now - lastTime) / 1000) : 0;
    lastTime = now;

    const levelConfig = ctx.getLevelConfig();
    const tilt = sensor.getTilt();
    const player = playerPosition(exercise, tilt);
    let target;

    if (phase === 'countdown') {
      countdownLeft -= dt;
      const shown = Math.max(1, Math.ceil(countdownLeft));
      if (shown !== lastCountShown) {
        lastCountShown = shown;
        setText(countEl, String(shown));
        if (tickMode === 'all' || shown <= 3) audio.play('tick');
      }
      if (!calibrated && countdownLeft <= 1) {
        sensor.calibrateZero();
        calibrated = true;
      }
      if (countdownLeft <= 0) {
        phase = 'running';
        prestartEl.hidden = true;
        audio.play('go');
      }
      target = isTag ? tag.target : targetPosition(exercise, 0, levelConfig.targetSpeedMultiplier);
    } else if (phase === 'running') {
      elapsed = Math.min(durationSec, elapsed + dt);
      if (isTag) {
        if (tag.update(dt, player).caught) {
          audio.play('catch');
          catchFlash = CATCH_FLASH_SEC;
        }
        target = tag.target;
      } else {
        target = targetPosition(exercise, elapsed, levelConfig.targetSpeedMultiplier);
        scorer.add(trackingDistance(exercise, player, target), levelConfig.toleranceRadius, dt);
      }
      catchFlash = Math.max(0, catchFlash - dt);

      const remaining = durationSec - elapsed;
      const remainingWhole = Math.ceil(remaining);
      if (remainingWhole > 0 && remainingWhole <= FINAL_TICK_SECONDS && remainingWhole !== lastTickSecond) {
        lastTickSecond = remainingWhole;
        audio.play('tick');
      }
      updateHud(remaining);
      if (remaining <= 0) {
        render(player, target, levelConfig);
        finish();
        return;
      }
    } else {
      return;
    }

    render(player, target, levelConfig);
    rafId = requestAnimationFrame(frame);
  }

  function finish() {
    phase = 'finished';
    cancelAnimationFrame(rafId);
    el.classList.add('is-finished');
    const base = { exerciseId: exercise.id, level, durationSec, score: currentScore() };
    const result = isTag
      ? { ...base, rawValue: tag.caught, caught: tag.caught, targetCount: tagGoal }
      : { ...base, rawValue: Math.round(scorer.timeInTolerance * 10) / 10, timeInTolerance: scorer.timeInTolerance };
    onFinish(result);
  }

  function abort(reason = 'user') {
    if (phase !== 'countdown' && phase !== 'running') return;
    phase = 'aborted';
    cancelAnimationFrame(rafId);
    if (onAbort) onAbort(reason);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') abort('hidden');
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ---- Rendering ------------------------------------------------------------------------
  function render(player, target, levelConfig) {
    if (!stage.beginFrame()) return;
    const g = stage.ctx;
    const width = stage.width;
    const height = stage.height;
    const margin = Math.max(28, height * 0.08);
    const radius = Math.max(40, Math.min(width, height) / 2 - margin);
    const radiusX = exercise.layout === 'rail-h' ? Math.max(radius, Math.min(width / 2 - margin * 1.6, radius * 1.7)) : radius;
    const cx = width / 2;
    const cy = height / 2;
    const toScreen = (p) => ({ x: cx + p.x * radiusX, y: cy - p.y * radius });
    const ballRadius = Math.max(10, radius * 0.085);
    const tolerance = levelConfig.toleranceRadius;
    const distance = isTag
      ? Math.hypot(player.x - target.x, player.y - target.y)
      : trackingDistance(exercise, player, target);
    const inside = distance <= tolerance;
    const targetScreen = toScreen(target);

    switch (exercise.layout) {
      case 'target':
        drawRings(g, cx, cy, radius);
        drawToleranceCircle(g, cx, cy, tolerance * radius, { active: inside });
        break;
      case 'rail-h':
        drawTube(g, [{ x: cx - radiusX - ballRadius, y: cy }, { x: cx + radiusX + ballRadius, y: cy }], ballRadius * 2.6);
        drawToleranceBand(g, targetScreen.x - tolerance * radiusX, cy - ballRadius * 1.3, 2 * tolerance * radiusX, ballRadius * 2.6, inside);
        break;
      case 'rail-v':
        drawTube(g, [{ x: cx, y: cy - radius - ballRadius }, { x: cx, y: cy + radius + ballRadius }], ballRadius * 2.6);
        drawToleranceBand(g, cx - ballRadius * 1.3, targetScreen.y - tolerance * radius, ballRadius * 2.6, 2 * tolerance * radius, inside);
        break;
      case 'chase':
        drawField(g, cx, cy, radius);
        drawDottedPath(g, CHASE_PATH.map(toScreen));
        drawToleranceCircle(g, targetScreen.x, targetScreen.y, tolerance * radius, { active: inside });
        break;
      case 'orbit': {
        const ring = [];
        for (let i = 0; i < 96; i += 1) {
          const angle = (i / 96) * Math.PI * 2;
          ring.push(toScreen({ x: ORBIT_RADIUS * Math.cos(angle), y: ORBIT_RADIUS * Math.sin(angle) }));
        }
        drawTube(g, ring, ballRadius * 2.6, { closed: true });
        drawOrbitArrows(
          g,
          cx,
          cy,
          ORBIT_RADIUS * radius + ballRadius * 2.6,
          exercise.direction === 'ccw' ? 'ccw' : 'cw',
          Math.max(9, ballRadius * 1.1),
        );
        drawToleranceCircle(g, targetScreen.x, targetScreen.y, tolerance * radius, { active: inside });
        break;
      }
      case 'tag':
        drawField(g, cx, cy, radius);
        drawTagTarget(g, targetScreen, tolerance * radius, tag.holdProgress, catchFlash / CATCH_FLASH_SEC);
        break;
      case 'arc':
        drawTube(g, ARC_PATHS[exercise.arc === 'rear' ? 'rear' : 'front'].map(toScreen), ballRadius * 2.6);
        drawToleranceCircle(g, targetScreen.x, targetScreen.y, tolerance * radius, { active: inside });
        break;
      default:
        break;
    }

    if (exercise.layout !== 'target') drawBall(g, targetScreen.x, targetScreen.y, ballRadius, 'target');
    const playerScreen = toScreen(player);
    drawBall(g, playerScreen.x, playerScreen.y, ballRadius, 'player', { highlight: inside });

    if (!sensor.isDelivering()) {
      drawNotice(g, t(`diag.status.${sensor.getStatus()}`), cx, height - 12, Math.max(14, radius * 0.08));
    }
  }

  return {
    el,
    start() {
      if (phase !== 'idle') return;
      phase = 'countdown';
      if (prestartSound) audio.play(prestartSound);
      audio.speak(announce ?? name);
      rafId = requestAnimationFrame(frame);
    },
    abort,
    get phase() {
      return phase;
    },
    destroy() {
      if (phase === 'countdown' || phase === 'running') phase = 'aborted';
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stage.destroy();
      el.remove();
    },
  };
}

// ---- Zeichenhelfer --------------------------------------------------------------------------

function drawToleranceBand(g, x, y, width, height, active) {
  g.save();
  g.fillStyle = active ? 'rgba(46, 125, 50, 0.24)' : 'rgba(76, 175, 80, 0.16)';
  g.strokeStyle = active ? COLORS.toleranceStrong : COLORS.tolerance;
  g.lineWidth = 2;
  g.setLineDash([6, 5]);
  const r = Math.min(width, height) / 2;
  g.beginPath();
  if (typeof g.roundRect === 'function') g.roundRect(x, y, width, height, r);
  else g.rect(x, y, width, height);
  g.fill();
  g.stroke();
  g.restore();
}

function drawField(g, cx, cy, radius) {
  g.save();
  g.fillStyle = '#F7F8FA';
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fill();
  g.setLineDash([4, 8]);
  g.strokeStyle = '#C9CED6';
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(30, 34, 39, 0.08)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - radius, cy);
  g.lineTo(cx + radius, cy);
  g.moveTo(cx, cy - radius);
  g.lineTo(cx, cy + radius);
  g.stroke();
  g.restore();
}

function drawDottedPath(g, points) {
  g.save();
  g.strokeStyle = '#C3C8CF';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.setLineDash([0.1, 9]);
  g.beginPath();
  points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.stroke();
  g.restore();
}

/** Richtungspfeile außen am Orbit-Ring. */
function drawOrbitArrows(g, cx, cy, radius, direction, size) {
  const sign = direction === 'ccw' ? -1 : 1; // Bildschirmwinkel steigen im Uhrzeigersinn
  g.save();
  g.fillStyle = 'rgba(185, 72, 15, 0.8)';
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    const tx = -Math.sin(angle) * sign;
    const ty = Math.cos(angle) * sign;
    g.beginPath();
    g.moveTo(px + tx * size, py + ty * size);
    g.lineTo(px - tx * size * 0.6 + ty * size * 0.7, py - ty * size * 0.6 - tx * size * 0.7);
    g.lineTo(px - tx * size * 0.6 - ty * size * 0.7, py - ty * size * 0.6 + tx * size * 0.7);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** Tag-Ziel: Toleranzkreis mit Halte-Fortschritt und kurzem Aufblitzen nach einem Fang. */
function drawTagTarget(g, center, radius, holdProgress, flash) {
  g.save();
  g.fillStyle = `rgba(76, 175, 80, ${0.1 + flash * 0.3})`;
  g.beginPath();
  g.arc(center.x, center.y, radius, 0, Math.PI * 2);
  g.fill();
  g.restore();
  drawToleranceCircle(g, center.x, center.y, radius, { active: holdProgress > 0 });
  if (holdProgress > 0) {
    g.save();
    g.strokeStyle = COLORS.toleranceStrong;
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(center.x, center.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + holdProgress * Math.PI * 2);
    g.stroke();
    g.restore();
  }
}
