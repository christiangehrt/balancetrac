/**
 * gameEngine.js – Gemeinsame Basis für die 2D-Canvas-Spiele (Labyrinth, Astro Guard).
 *
 * Spiel-Schnittstelle (jedes Spiel liefert ein Objekt mit diesen Methoden):
 *   resize(width, height)                         Canvas-Größe in CSS-Pixeln hat sich geändert
 *   update(dt, input)                             fester Zeitschritt (FIXED_STEP Sekunden)
 *   render(g, width, height, view)                zeichnet den aktuellen Zustand (view.phase, view.time)
 *   isFinished() → boolean                        Spiel ist vorbei (Ziel erreicht, Game Over …)
 *   getResult() → {activityId, score, rawValue, durationSec, …}
 *   destroy()                                     optional
 * input = { x, y, yaw, delivering } – normierter TiltState des Boards (−1 … +1)
 *
 * createGameSession() übernimmt den gemeinsamen Ablauf: HiDPI-Canvas, Aufsteig-Countdown mit
 * Auto-Kalibrierung in der letzten Sekunde, Game-Loop mit festem Zeitschritt, Pause (auch automatisch
 * beim Wechsel in den Hintergrund), Abbrechen und Ergebnis-Übergabe.
 *
 * Die reinen Hilfsfunktionen (Zeitschritt, Kollision, Zeitformat) sind DOM-frei und in Node testbar.
 */

import { createHiDpiCanvas } from '../views/canvasKit.js';
import { h, iconButton, setText } from '../views/ui.js';

export const FIXED_STEP = 1 / 120;
export const MAX_STEPS_PER_FRAME = 12;
export const MAX_FRAME_DT = 0.1;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Zeit im Format mm:ss.
 * @param {number} seconds
 */
export function formatTimeMMSS(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Akkumulator für einen festen Physik-Zeitschritt (unabhängig von der Bildrate).
 * @param {number} [step]
 * @param {number} [maxSteps]  Obergrenze je Frame (verhindert "Spiral of Death" nach Rucklern)
 */
export function createFixedStepper(step = FIXED_STEP, maxSteps = MAX_STEPS_PER_FRAME) {
  let accumulator = 0;
  return {
    /**
     * @param {number} frameDt  vergangene Zeit seit dem letzten Frame (Sekunden)
     * @returns {number} Anzahl der jetzt auszuführenden Schritte
     */
    advance(frameDt) {
      const dt = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : 0;
      accumulator = Math.min(accumulator + dt, step * maxSteps);
      const steps = Math.floor(accumulator / step + 1e-9);
      accumulator -= steps * step;
      if (accumulator < 0) accumulator = 0;
      return steps;
    },
    /** Anteil des nächsten Schritts (0..1) für Interpolation. */
    get alpha() {
      return accumulator / step;
    },
    reset() {
      accumulator = 0;
    },
  };
}

/**
 * Kollision Kreis ↔ achsenparalleles Rechteck.
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @returns {{nx: number, ny: number, depth: number} | null} Normale zeigt vom Rechteck zur Kugel
 */
export function circleRectCollision(cx, cy, r, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq >= r * r) return null;
  if (distanceSq > 1e-12) {
    const distance = Math.sqrt(distanceSq);
    return { nx: dx / distance, ny: dy / distance, depth: r - distance };
  }
  // Mittelpunkt liegt im Rechteck: über die nächstgelegene Kante hinausschieben
  const left = cx - rect.x;
  const right = rect.x + rect.w - cx;
  const top = cy - rect.y;
  const bottom = rect.y + rect.h - cy;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return { nx: -1, ny: 0, depth: r + left };
  if (min === right) return { nx: 1, ny: 0, depth: r + right };
  if (min === top) return { nx: 0, ny: -1, depth: r + top };
  return { nx: 0, ny: 1, depth: r + bottom };
}

/**
 * Löst die Kollisionen einer Kugel mit Wänden: Position aus der Wand schieben, Normalgeschwindigkeit
 * mit Restitution reflektieren (leichtes Abprallen), Tangentialanteil leicht dämpfen. Durch die
 * Nächster-Punkt-Methode gleitet die Kugel an Ecken ab, statt sich festzuklemmen.
 * @param {{x: number, y: number, vx: number, vy: number, r: number}} body  wird verändert
 * @param {ReadonlyArray<{x: number, y: number, w: number, h: number}>} rects
 * @param {{restitution?: number, tangentialDamping?: number, iterations?: number}} [options]
 * @returns {number} stärkste Aufprallgeschwindigkeit (für Sound)
 */
export function resolveCircleCollisions(body, rects, { restitution = 0.35, tangentialDamping = 0.04, iterations = 3 } = {}) {
  let impact = 0;
  for (let pass = 0; pass < iterations; pass += 1) {
    let collided = false;
    for (const rect of rects) {
      const hit = circleRectCollision(body.x, body.y, body.r, rect);
      if (!hit) continue;
      collided = true;
      body.x += hit.nx * hit.depth;
      body.y += hit.ny * hit.depth;
      const normalSpeed = body.vx * hit.nx + body.vy * hit.ny;
      if (normalSpeed < 0) {
        impact = Math.max(impact, -normalSpeed);
        body.vx -= (1 + restitution) * normalSpeed * hit.nx;
        body.vy -= (1 + restitution) * normalSpeed * hit.ny;
        const tx = -hit.ny;
        const ty = hit.nx;
        const tangentSpeed = body.vx * tx + body.vy * ty;
        body.vx -= tangentialDamping * tangentSpeed * tx;
        body.vy -= tangentialDamping * tangentSpeed * ty;
      }
    }
    if (!collided) break;
  }
  return impact;
}

/**
 * Achsenparallele Rechteck-Überlappung.
 * @param {{x: number, y: number, w: number, h: number}} a
 * @param {{x: number, y: number, w: number, h: number}} b
 */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Gemeinsamer Spielablauf mit Countdown, Pause, Abbruch und Ergebnis.
 * @param {{
 *   ctx: object,
 *   game: object,
 *   title: string,
 *   instruction: string,
 *   countdownSec: number,
 *   onFinish: (result: object) => void,
 *   onAbort: () => void,
 *   finishDelaySec?: number,
 * }} options
 */
export function createGameSession({ ctx, game, title, instruction, countdownSec, onFinish, onAbort, finishDelaySec = 1.2 }) {
  const { t, sensor, audio } = ctx;

  // ---- DOM ------------------------------------------------------------------------------
  const stageEl = h('div', { class: 'game-stage' });
  const stage = createHiDpiCanvas(stageEl, {
    className: 'stage-canvas',
    label: title,
    onResize: () => {
      game.resize(stage.width, stage.height);
      // Nach Spielende läuft keine Schleife mehr – einmal neu zeichnen, damit das Bild erhalten bleibt
      if (phase === 'finished' && stage.beginFrame()) game.render(stage.ctx, stage.width, stage.height, { phase, time: clock });
    },
  });

  const pauseButton = iconButton({ icon: 'pause', label: t('play.pauseButton'), onClick: () => pause() });
  const stopButton = iconButton({ icon: 'close', label: t('play.stopButton'), onClick: () => abort() });
  const controls = h('div', { class: 'game-controls' }, pauseButton, stopButton);

  const countEl = h('div', { class: 'prestart-count', 'aria-live': 'assertive' }, String(Math.ceil(countdownSec)));
  const countdownOverlay = h(
    'div',
    { class: 'prestart game-overlay' },
    h(
      'div',
      { class: 'prestart-card' },
      h('h2', { class: 'prestart-title', text: title }),
      h('p', { class: 'prestart-text', text: instruction }),
      countEl,
      h('p', { class: 'prestart-hint', text: t('measure.getReady') }),
    ),
  );

  const resumeButton = h('button', { type: 'button', class: 'btn btn-primary' }, t('play.resume'));
  resumeButton.addEventListener('click', () => resume());
  const quitButton = h('button', { type: 'button', class: 'btn' }, t('play.quit'));
  quitButton.addEventListener('click', () => abort());
  const pauseOverlay = h(
    'div',
    { class: 'prestart game-overlay' },
    h(
      'div',
      { class: 'prestart-card' },
      h('h2', { class: 'prestart-title', text: t('play.paused') }),
      h('div', { class: 'result-actions' }, resumeButton, quitButton),
    ),
  );
  pauseOverlay.hidden = true;

  const el = h('section', { class: 'game-view', 'aria-label': title }, stageEl, controls, countdownOverlay, pauseOverlay);

  // ---- Zustand --------------------------------------------------------------------------
  let phase = 'idle'; // idle | countdown | running | ending | paused | finished | aborted
  let phaseBeforePause = 'running';
  let countdownLeft = Math.max(1, countdownSec);
  let lastCountShown = null;
  let calibrated = false;
  let endTimer = 0;
  let rafId = 0;
  let lastTime = 0;
  let clock = 0;
  const stepper = createFixedStepper();

  function readInput() {
    const tilt = sensor.getTilt();
    return { x: tilt.x, y: tilt.y, yaw: tilt.yaw, delivering: sensor.isDelivering() };
  }

  function frame(now) {
    const dt = lastTime ? Math.min(MAX_FRAME_DT, (now - lastTime) / 1000) : 0;
    lastTime = now;
    clock += dt;

    if (phase === 'countdown') {
      countdownLeft -= dt;
      const shown = Math.max(1, Math.ceil(countdownLeft));
      if (shown !== lastCountShown) {
        lastCountShown = shown;
        setText(countEl, String(shown));
        audio.play('tick');
      }
      if (!calibrated && countdownLeft <= 1) {
        sensor.calibrateZero();
        calibrated = true;
      }
      if (countdownLeft <= 0) {
        phase = 'running';
        countdownOverlay.hidden = true;
        stepper.reset();
        audio.play('go');
      }
    } else if (phase === 'running' || phase === 'ending') {
      const steps = stepper.advance(dt);
      for (let i = 0; i < steps; i += 1) game.update(FIXED_STEP, readInput());
      if (phase === 'running' && game.isFinished()) {
        phase = 'ending';
        endTimer = finishDelaySec;
      } else if (phase === 'ending') {
        endTimer -= dt;
        if (endTimer <= 0) {
          finish();
          return;
        }
      }
    }

    if (stage.beginFrame()) game.render(stage.ctx, stage.width, stage.height, { phase, time: clock });
    if (phase !== 'finished' && phase !== 'aborted') rafId = requestAnimationFrame(frame);
  }

  function finish() {
    phase = 'finished';
    cancelAnimationFrame(rafId);
    el.classList.add('is-finished');
    onFinish(game.getResult());
  }

  function pause() {
    if (phase !== 'countdown' && phase !== 'running') return;
    phaseBeforePause = phase;
    phase = 'paused';
    pauseOverlay.hidden = false;
    resumeButton.focus();
  }

  function resume() {
    if (phase !== 'paused') return;
    phase = phaseBeforePause;
    pauseOverlay.hidden = true;
    lastTime = 0;
    stepper.reset();
  }

  function abort() {
    if (phase === 'finished' || phase === 'aborted') return;
    phase = 'aborted';
    cancelAnimationFrame(rafId);
    onAbort();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') pause();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'p' && event.key !== 'P') return;
    if (document.querySelector('.drawer, .dialog')) return;
    if (phase === 'paused') {
      event.preventDefault();
      resume();
    } else if (phase === 'countdown' || phase === 'running') {
      event.preventDefault();
      pause();
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('keydown', onKeyDown);

  return {
    el,
    start() {
      if (phase !== 'idle') return;
      phase = 'countdown';
      audio.speak(title);
      stage.refresh();
      rafId = requestAnimationFrame(frame);
    },
    pause,
    resume,
    abort,
    get phase() {
      return phase;
    },
    destroy() {
      if (phase !== 'finished') phase = 'aborted';
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('keydown', onKeyDown);
      if (typeof game.destroy === 'function') game.destroy();
      stage.destroy();
      el.remove();
    },
  };
}
