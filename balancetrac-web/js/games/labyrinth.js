/**
 * labyrinth.js – Spiel 1: Holz-Labyrinth mit 2D-Kugelphysik.
 *
 *  - Roll/Pitch wirken als Beschleunigungsvektor auf die Kugel (Delta-Time, fester Zeitschritt)
 *  - Trägheit, Luft-/Rollreibung, Kreis-Rechteck-Kollision mit leichtem Abprallen (gameEngine.js)
 *  - Level 3: Falllöcher setzen die Kugel zurück zum Start
 *  - Dunkle, prozedural erzeugte Holzmaserung + goldene Wände auf einem statischen Offscreen-Layer
 *  - Timer mm:ss oben rechts, Score relativ zur Par-Zeit
 *
 * Die Spiellogik (update) greift nicht auf das DOM zu und ist in Node testbar; nur render() zeichnet.
 */

import { createRandom } from '../exercises.js';
import { labyrinthScore } from '../scoring.js';
import { clamp, formatTimeMMSS, resolveCircleCollisions } from './gameEngine.js';
import { BALL_RADIUS, cellCenter, GOAL_RADIUS, HOLE_RADIUS, WALL_THICKNESS } from './mazeData.js';

export const LABYRINTH_ACTIVITY_ID = 'LABYRINTH';

export const LABYRINTH_PHYSICS = Object.freeze({
  /** Beschleunigung bei vollem Ausschlag (Zellen/s²). */
  acceleration: 10,
  /** Luftreibung (1/s, exponentiell). */
  drag: 0.9,
  /** Rollreibung (Zellen/s², konstant gegen die Bewegung). */
  rollingFriction: 0.8,
  maxSpeed: 7,
  restitution: 0.3,
  /** Kugel fällt, wenn ihr Mittelpunkt näher als dieser Wert an der Lochmitte ist. */
  holeCaptureRadius: HOLE_RADIUS - BALL_RADIUS * 0.3,
  goalCaptureRadius: GOAL_RADIUS - BALL_RADIUS * 0.35,
  fallDurationSec: 0.7,
  goalDurationSec: 0.6,
  /** Spätestens danach endet die Runde (Score 0). */
  maxTimeSec: 600,
});

const COLORS = Object.freeze({
  background: '#1B110A',
  wallLight: '#F6D77C',
  wallMid: '#D9A93F',
  wallDark: '#9E7224',
  wallHighlight: 'rgba(255, 246, 210, 0.75)',
  wallShadow: 'rgba(0, 0, 0, 0.5)',
  hudText: '#FFF4DC',
  hudMuted: 'rgba(255, 236, 200, 0.75)',
  goalRing: '#F2C230',
});

/**
 * @param {{maze: object, audio?: {play: (name: string) => void}, t?: (key: string, params?: object) => string, seed?: number}} options
 */
export function createLabyrinthGame({ maze, audio = { play() {} }, t = (key) => key, seed = 7 }) {
  const physics = LABYRINTH_PHYSICS;
  const start = cellCenter(maze.start);
  const goal = cellCenter(maze.goal);
  const holes = maze.holes.map(cellCenter);
  const ball = { x: start.x, y: start.y, vx: 0, vy: 0, r: BALL_RADIUS };

  let state = 'playing'; // playing | falling | goal | timeout
  let elapsed = 0;
  let animation = 0;
  let falls = 0;
  let bumpCooldown = 0;
  let fallPoint = null;
  let layout = null;
  let staticLayer = null;

  function resetBall() {
    ball.x = start.x;
    ball.y = start.y;
    ball.vx = 0;
    ball.vy = 0;
  }

  function update(dt, input) {
    if (state === 'goal' || state === 'timeout') {
      animation = Math.min(physics.goalDurationSec, animation + dt);
      return;
    }
    elapsed += dt;
    if (elapsed >= physics.maxTimeSec) {
      state = 'timeout';
      animation = 0;
      return;
    }
    if (state === 'falling') {
      animation += dt;
      if (animation >= physics.fallDurationSec) {
        state = 'playing';
        animation = 0;
        resetBall();
      }
      return;
    }

    // Beschleunigung aus der Neigung: rechts kippen → nach rechts, vorne kippen → nach oben (y nach unten)
    const ix = Number.isFinite(input?.x) ? clamp(input.x, -1, 1) : 0;
    const iy = Number.isFinite(input?.y) ? clamp(input.y, -1, 1) : 0;
    ball.vx += ix * physics.acceleration * dt;
    ball.vy += -iy * physics.acceleration * dt;

    const damping = Math.exp(-physics.drag * dt);
    ball.vx *= damping;
    ball.vy *= damping;
    let speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0) {
      const reduced = Math.max(0, speed - physics.rollingFriction * dt);
      const capped = Math.min(reduced, physics.maxSpeed);
      ball.vx *= capped / speed;
      ball.vy *= capped / speed;
      speed = capped;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const impact = resolveCircleCollisions(ball, maze.wallRects, { restitution: physics.restitution });
    // Sicherheitsnetz: niemals außerhalb des Spielfelds
    ball.x = clamp(ball.x, ball.r, maze.cols - ball.r);
    ball.y = clamp(ball.y, ball.r, maze.rows - ball.r);

    bumpCooldown = Math.max(0, bumpCooldown - dt);
    if (impact > 1.2 && bumpCooldown === 0) {
      audio.play('bump');
      bumpCooldown = 0.12;
    }

    for (const hole of holes) {
      if (Math.hypot(ball.x - hole.x, ball.y - hole.y) < physics.holeCaptureRadius) {
        state = 'falling';
        animation = 0;
        falls += 1;
        fallPoint = hole;
        audio.play('warning');
        return;
      }
    }

    if (Math.hypot(ball.x - goal.x, ball.y - goal.y) < physics.goalCaptureRadius) {
      state = 'goal';
      animation = 0;
      audio.play('catch');
    }
  }

  // ---- Rendering ------------------------------------------------------------------------
  function resize(width, height) {
    layout = computeLayout(width, height, maze);
    staticLayer = null;
  }

  function render(g, width, height, view) {
    if (!layout || layout.width !== width || layout.height !== height) resize(width, height);
    if (!staticLayer) staticLayer = renderStaticLayer(layout, maze, holes, seed);
    g.drawImage(staticLayer, 0, 0, width, height);

    const { scale, ox, oy } = layout;
    const sx = (x) => ox + x * scale;
    const sy = (y) => oy + y * scale;

    // Ziel mit pulsierendem Leuchten
    const pulse = 0.5 + 0.5 * Math.sin((view?.time ?? 0) * 3);
    const goalR = GOAL_RADIUS * scale;
    g.save();
    const glow = g.createRadialGradient(sx(goal.x), sy(goal.y), goalR * 0.6, sx(goal.x), sy(goal.y), goalR * (1.7 + pulse * 0.4));
    glow.addColorStop(0, 'rgba(242, 194, 48, 0.45)');
    glow.addColorStop(1, 'rgba(242, 194, 48, 0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(sx(goal.x), sy(goal.y), goalR * 2.2, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Kugel
    let ballScale = 1;
    let bx = ball.x;
    let by = ball.y;
    if (state === 'falling' && fallPoint) {
      const p = Math.min(1, animation / physics.fallDurationSec);
      ballScale = 1 - p * 0.85;
      bx = ball.x + (fallPoint.x - ball.x) * p;
      by = ball.y + (fallPoint.y - ball.y) * p;
    } else if (state === 'goal') {
      const p = Math.min(1, animation / physics.goalDurationSec);
      ballScale = 1 - p * 0.75;
      bx = ball.x + (goal.x - ball.x) * p;
      by = ball.y + (goal.y - ball.y) * p;
    }
    drawWhiteBall(g, sx(bx), sy(by), BALL_RADIUS * scale * ballScale);

    // HUD
    const hudCenter = layout.hud / 2;
    const big = Math.round(clamp(layout.hud * 0.62, 30, 52));
    const small = Math.round(clamp(layout.hud * 0.3, 13, 22));
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.7)';
    g.shadowBlur = 6;
    g.fillStyle = COLORS.hudText;
    g.textBaseline = 'middle';
    g.font = `800 ${big}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'right';
    g.fillText(formatTimeMMSS(elapsed), width - layout.margin, hudCenter - small * 0.35);
    g.font = `600 ${small}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.fillStyle = COLORS.hudMuted;
    g.fillText(t('play.labyrinth.par', { time: formatTimeMMSS(maze.parSec) }), width - layout.margin, hudCenter + big * 0.45);
    g.textAlign = 'left';
    g.fillStyle = COLORS.hudText;
    g.font = `700 ${Math.round(big * 0.6)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.fillText(t('play.labyrinth.mazeLabel', { index: maze.index, count: 5 }), layout.margin, hudCenter - small * 0.35);
    g.font = `600 ${small}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.fillStyle = COLORS.hudMuted;
    g.fillText(`L${maze.level}${falls > 0 ? ` · ${t('play.labyrinth.fallsShort', { count: falls })}` : ''}`, layout.margin, hudCenter + big * 0.45);
    g.restore();
  }

  return {
    id: LABYRINTH_ACTIVITY_ID,
    maze,
    resize,
    update,
    render,
    isFinished: () => state === 'goal' || state === 'timeout',
    getResult() {
      const completed = state === 'goal';
      const durationSec = Math.round(elapsed * 10) / 10;
      return {
        activityId: LABYRINTH_ACTIVITY_ID,
        mazeId: maze.id,
        completed,
        durationSec,
        rawValue: durationSec,
        parSec: maze.parSec,
        falls,
        score: completed ? labyrinthScore(elapsed, maze.parSec) : 0,
      };
    },
    get state() {
      return state;
    },
    get elapsed() {
      return elapsed;
    },
    get ball() {
      return { ...ball };
    },
    get falls() {
      return falls;
    },
  };
}

// ---- Layout & statische Ebene -------------------------------------------------------------

function computeLayout(width, height, maze) {
  const hud = clamp(height * 0.14, 44, 80);
  const margin = Math.max(10, Math.min(width, height) * 0.03);
  const availableWidth = Math.max(10, width - margin * 2);
  const availableHeight = Math.max(10, height - hud - margin);
  const pad = WALL_THICKNESS;
  const scale = Math.max(4, Math.min(availableWidth / (maze.cols + pad * 2), availableHeight / (maze.rows + pad * 2)));
  const boardWidth = maze.cols * scale;
  const boardHeight = maze.rows * scale;
  return {
    width,
    height,
    hud,
    margin,
    scale,
    ox: (width - boardWidth) / 2,
    oy: hud + (availableHeight - boardHeight) / 2,
  };
}

/** Holz, Wandschatten, goldene Wände und Löcher – einmal je Größe auf ein Offscreen-Canvas. */
function renderStaticLayer(layout, maze, holes, seed) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * dpr));
  canvas.height = Math.max(1, Math.round(layout.height * dpr));
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  paintWood(g, layout.width, layout.height, seed);

  const { scale, ox, oy } = layout;
  const toRect = (r) => ({ x: ox + r.x * scale, y: oy + r.y * scale, w: r.w * scale, h: r.h * scale });

  // Löcher (Level 3)
  for (const hole of holes) {
    const cx = ox + hole.x * scale;
    const cy = oy + hole.y * scale;
    const r = HOLE_RADIUS * scale;
    const gradient = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(0.75, '#090503');
    gradient.addColorStop(1, '#3A2414');
    g.fillStyle = gradient;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.lineWidth = Math.max(1.5, scale * 0.03);
    g.stroke();
  }

  // Ziel-Loch mit goldenem Ring
  const goal = cellCenter(maze.goal);
  const gx = ox + goal.x * scale;
  const gy = oy + goal.y * scale;
  const gr = GOAL_RADIUS * scale;
  const goalGradient = g.createRadialGradient(gx, gy, gr * 0.1, gx, gy, gr);
  goalGradient.addColorStop(0, '#000000');
  goalGradient.addColorStop(1, '#1A0E06');
  g.fillStyle = goalGradient;
  g.beginPath();
  g.arc(gx, gy, gr, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = COLORS.goalRing;
  g.lineWidth = Math.max(2.5, scale * 0.06);
  g.stroke();
  g.fillStyle = COLORS.goalRing;
  drawStar(g, gx, gy, gr * 0.45, gr * 0.2);

  // Start-Markierung
  const start = cellCenter(maze.start);
  g.strokeStyle = 'rgba(255, 236, 200, 0.25)';
  g.lineWidth = Math.max(1.5, scale * 0.025);
  g.setLineDash([scale * 0.06, scale * 0.06]);
  g.beginPath();
  g.arc(ox + start.x * scale, oy + start.y * scale, BALL_RADIUS * scale * 1.35, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // Wandschatten
  g.fillStyle = COLORS.wallShadow;
  for (const rect of maze.wallRects) {
    const r = toRect(rect);
    roundRect(g, r.x + scale * 0.05, r.y + scale * 0.07, r.w, r.h, Math.min(r.w, r.h) / 2);
    g.fill();
  }

  // Goldene Wände
  for (const rect of maze.wallRects) {
    const r = toRect(rect);
    const horizontal = r.w >= r.h;
    const gradient = horizontal ? g.createLinearGradient(0, r.y, 0, r.y + r.h) : g.createLinearGradient(r.x, 0, r.x + r.w, 0);
    gradient.addColorStop(0, COLORS.wallLight);
    gradient.addColorStop(0.5, COLORS.wallMid);
    gradient.addColorStop(1, COLORS.wallDark);
    g.fillStyle = gradient;
    roundRect(g, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) / 2);
    g.fill();
    g.strokeStyle = COLORS.wallHighlight;
    g.lineWidth = Math.max(1, scale * 0.012);
    g.beginPath();
    if (horizontal) {
      g.moveTo(r.x + r.h / 2, r.y + 1);
      g.lineTo(r.x + r.w - r.h / 2, r.y + 1);
    } else {
      g.moveTo(r.x + 1, r.y + r.w / 2);
      g.lineTo(r.x + 1, r.y + r.h - r.w / 2);
    }
    g.stroke();
  }
  return canvas;
}

/** Dunkle Holzmaserung mit Brettfugen und Ästen (deterministisch per Seed). */
function paintWood(g, width, height, seed) {
  const random = createRandom(seed);
  const base = g.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, '#4A2C1A');
  base.addColorStop(0.5, '#3A2213');
  base.addColorStop(1, '#2A170C');
  g.fillStyle = base;
  g.fillRect(0, 0, width, height);

  const knots = [];
  const knotCount = 3 + Math.floor(random() * 3);
  for (let i = 0; i < knotCount; i += 1) {
    knots.push({
      x: random() * width,
      y: random() * height,
      rx: 5 + random() * 10,
      ry: 12 + random() * 22,
      rotation: (random() - 0.5) * 0.5,
    });
  }

  // Maserung: senkrechte, wellige Fasern, die um die Äste herumlaufen
  const fibers = Math.ceil(width / 2.6);
  for (let i = 0; i < fibers; i += 1) {
    const x0 = (i / fibers) * width + (random() - 0.5) * 3;
    const amplitude = 1.5 + random() * 5;
    const frequency = 0.004 + random() * 0.01;
    const phase = random() * Math.PI * 2;
    const light = random() < 0.42;
    g.strokeStyle = light ? `rgba(255, 214, 170, ${(0.025 + random() * 0.06).toFixed(3)})` : `rgba(15, 6, 2, ${(0.08 + random() * 0.18).toFixed(3)})`;
    g.lineWidth = 0.5 + random() * 1.8;
    g.beginPath();
    for (let y = -12; y <= height + 12; y += 7) {
      let x = x0 + Math.sin(y * frequency + phase) * amplitude + Math.sin(y * frequency * 2.7 + phase * 1.3) * amplitude * 0.35;
      for (const knot of knots) {
        const dy = (y - knot.y) / (knot.ry * 1.8);
        const dx = x0 - knot.x;
        const reach = knot.rx * 4;
        if (Math.abs(dx) < reach) {
          x += Math.sign(dx || 1) * Math.exp(-dy * dy) * (reach - Math.abs(dx)) * 0.55;
        }
      }
      if (y === -12) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  // Äste
  for (const knot of knots) {
    for (let ring = 6; ring >= 0; ring -= 1) {
      g.strokeStyle = `rgba(12, 5, 1, ${(0.08 + (6 - ring) * 0.035).toFixed(3)})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(knot.x, knot.y, knot.rx * (0.35 + ring * 0.32), knot.ry * (0.35 + ring * 0.32), knot.rotation, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(10, 4, 1, 0.55)';
    g.beginPath();
    g.ellipse(knot.x, knot.y, knot.rx * 0.35, knot.ry * 0.35, knot.rotation, 0, Math.PI * 2);
    g.fill();
  }

  // Brettfugen
  const planks = Math.max(3, Math.round(width / 180));
  for (let i = 1; i < planks; i += 1) {
    const x = (i / planks) * width + (random() - 0.5) * 12;
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(x, 0, 2, height);
    g.fillStyle = 'rgba(255, 220, 180, 0.06)';
    g.fillRect(x + 2, 0, 1, height);
  }

  // Vignette
  const vignette = g.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, width, height);
}

function roundRect(g, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + width, y, x + width, y + height, r);
  g.arcTo(x + width, y + height, x, y + height, r);
  g.arcTo(x, y + height, x, y, r);
  g.arcTo(x, y, x + width, y, r);
  g.closePath();
}

function drawStar(g, cx, cy, outer, inner) {
  g.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

function drawWhiteBall(g, x, y, r) {
  if (r <= 0.5) return;
  g.save();
  g.fillStyle = 'rgba(0, 0, 0, 0.45)';
  g.beginPath();
  g.ellipse(x + r * 0.3, y + r * 0.45, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
  g.fill();
  const gradient = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gradient.addColorStop(0, '#FFFFFF');
  gradient.addColorStop(0.6, '#EEF0F3');
  gradient.addColorStop(1, '#B9BFC8');
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
