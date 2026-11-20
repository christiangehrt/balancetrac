/**
 * exercises.js – Definitionen und Bahngleichungen der 9 Measure-Übungen (DOM-frei).
 *
 * Koordinatensystem (normiert, wie TiltState): x ∈ [-1, 1] rechts positiv, y ∈ [-1, 1] vorne/oben positiv.
 * Die Zielbahnen hängen von der Zeit t (Sekunden) und dem levelabhängigen targetSpeedMultiplier ab.
 */

export const RAIL_AMPLITUDE = 0.75;
export const RAIL_PERIOD_SEC = 8;
export const CHASE_AMPLITUDE_X = 0.7;
export const CHASE_AMPLITUDE_Y = 0.6;
/** Grundperiode der Lissajous-Bahn (Frequenzverhältnis 3:2); die volle Figur wiederholt sich nach dieser Zeit. */
export const CHASE_LOOP_SEC = 36;
export const ORBIT_RADIUS = 0.6;
export const ORBIT_PERIOD_SEC = 10;
/** Einblendzeit, in der der Orbit-Radius sanft von 0 auf ORBIT_RADIUS wächst (Start im Zentrum). */
export const ORBIT_LEAD_IN_SEC = 1.5;
export const TWIST_AMPLITUDE = 0.7;
export const TWIST_PERIOD_SEC = 9;
/** Twist-Bögen sind Kreisbögen mit Radius ARC_RADIUS; der Mittelpunkt liegt ARC_CENTER_OFFSET hinter bzw. vor dem Zentrum. */
export const ARC_RADIUS = 1;
export const ARC_CENTER_OFFSET = 0.55;
export const TAG_HOLD_SEC = 0.6;
export const TAG_MIN_RADIUS = 0.25;
export const TAG_MAX_RADIUS = 0.8;
export const TAG_MIN_JUMP = 0.45;

/** Die 9 Übungen in der Reihenfolge der 3×3-Übersicht. */
export const MEASURE_EXERCISES = Object.freeze([
  Object.freeze({ id: 'BULLS_EYE', number: 1, kind: 'tracking', layout: 'target', axes: Object.freeze(['roll', 'pitch']) }),
  Object.freeze({ id: 'SIDE_TO_SIDE', number: 2, kind: 'tracking', layout: 'rail-h', axes: Object.freeze(['roll']) }),
  Object.freeze({ id: 'FRONT_TO_BACK', number: 3, kind: 'tracking', layout: 'rail-v', axes: Object.freeze(['pitch']) }),
  Object.freeze({ id: 'CHASE', number: 4, kind: 'tracking', layout: 'chase', axes: Object.freeze(['roll', 'pitch']) }),
  Object.freeze({ id: 'ORBIT_CW', number: 5, kind: 'tracking', layout: 'orbit', direction: 'cw', axes: Object.freeze(['roll', 'pitch']) }),
  Object.freeze({ id: 'ORBIT_CCW', number: 6, kind: 'tracking', layout: 'orbit', direction: 'ccw', axes: Object.freeze(['roll', 'pitch']) }),
  Object.freeze({ id: 'TAG', number: 7, kind: 'tag', layout: 'tag', axes: Object.freeze(['roll', 'pitch']) }),
  Object.freeze({ id: 'FRONT_TWIST', number: 8, kind: 'tracking', layout: 'arc', arc: 'front', axes: Object.freeze(['pitch', 'yaw']) }),
  Object.freeze({ id: 'REAR_TWIST', number: 9, kind: 'tracking', layout: 'arc', arc: 'rear', axes: Object.freeze(['pitch', 'yaw']) }),
]);

export const MEASURE_EXERCISE_IDS = Object.freeze(MEASURE_EXERCISES.map((exercise) => exercise.id));

/**
 * @param {string} id
 * @returns {(typeof MEASURE_EXERCISES)[number] | null}
 */
export function getExercise(id) {
  return MEASURE_EXERCISES.find((exercise) => exercise.id === id) ?? null;
}

function speed(multiplier) {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function smoothstep(value) {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

/**
 * Punkt auf einem Twist-Bogen.
 *  front: nach vorne gebogen (Mitte am weitesten vorne, y > 0)
 *  rear:  nach hinten gebogen (Mitte am weitesten hinten, y < 0)
 * @param {'front'|'rear'} kind
 * @param {number} x
 * @returns {{x: number, y: number}}
 */
export function arcPoint(kind, x) {
  const clampedX = Math.max(-ARC_RADIUS, Math.min(ARC_RADIUS, x));
  const rise = Math.sqrt(ARC_RADIUS * ARC_RADIUS - clampedX * clampedX);
  return kind === 'rear'
    ? { x: clampedX, y: ARC_CENTER_OFFSET - rise }
    : { x: clampedX, y: rise - ARC_CENTER_OFFSET };
}

/**
 * Stützpunkte eines Twist-Bogens zum Zeichnen.
 * @param {'front'|'rear'} kind
 * @param {number} [steps=48]
 * @param {number} [extent=0.85]  halbe Breite in x
 */
export function arcPath(kind, steps = 48, extent = 0.85) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(arcPoint(kind, -extent + (2 * extent * i) / steps));
  return points;
}

/**
 * Punkt der Chase-Bahn (Lissajous 3:2, startet im Zentrum).
 * @param {number} tSec
 * @param {number} [multiplier=1]
 */
export function chasePoint(tSec, multiplier = 1) {
  const k = ((2 * Math.PI) / CHASE_LOOP_SEC) * speed(multiplier);
  return {
    x: CHASE_AMPLITUDE_X * Math.sin(3 * k * tSec),
    y: CHASE_AMPLITUDE_Y * Math.sin(2 * k * tSec),
  };
}

/**
 * Stützpunkte der kompletten Chase-Figur zum Zeichnen.
 * @param {number} [steps=180]
 */
export function chasePath(steps = 180) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(chasePoint((CHASE_LOOP_SEC * i) / steps, 1));
  return points;
}

/**
 * Zielposition einer Tracking-Übung zum Zeitpunkt t.
 * @param {{id: string, layout: string, direction?: string, arc?: string}} exercise
 * @param {number} tSec
 * @param {number} [multiplier=1]  targetSpeedMultiplier des Levels
 * @returns {{x: number, y: number}}
 */
export function targetPosition(exercise, tSec, multiplier = 1) {
  const t = Math.max(0, typeof tSec === 'number' && Number.isFinite(tSec) ? tSec : 0);
  const m = speed(multiplier);
  switch (exercise?.layout) {
    case 'rail-h':
      return { x: RAIL_AMPLITUDE * Math.sin(((2 * Math.PI) / RAIL_PERIOD_SEC) * m * t), y: 0 };
    case 'rail-v':
      return { x: 0, y: RAIL_AMPLITUDE * Math.sin(((2 * Math.PI) / RAIL_PERIOD_SEC) * m * t) };
    case 'chase':
      return chasePoint(t, m);
    case 'orbit': {
      const omega = ((2 * Math.PI) / ORBIT_PERIOD_SEC) * m;
      const radius = ORBIT_RADIUS * smoothstep(t / ORBIT_LEAD_IN_SEC);
      // Start oben; im Uhrzeigersinn nimmt der Winkel ab (y zeigt nach oben).
      const angle = Math.PI / 2 + (exercise.direction === 'ccw' ? 1 : -1) * omega * t;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    }
    case 'arc': {
      const x = TWIST_AMPLITUDE * Math.sin(((2 * Math.PI) / TWIST_PERIOD_SEC) * m * t);
      return arcPoint(exercise.arc === 'rear' ? 'rear' : 'front', x);
    }
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Spielerposition aus dem normierten TiltState.
 *  Twist-Übungen: x aus der Drehung (Yaw), y aus Pitch.
 *  Schienen: nur die jeweilige Achse.
 * @param {{layout: string}} exercise
 * @param {{x: number, y: number, yaw: number}} tilt
 * @returns {{x: number, y: number}}
 */
export function playerPosition(exercise, tilt) {
  const x = Number.isFinite(tilt?.x) ? tilt.x : 0;
  const y = Number.isFinite(tilt?.y) ? tilt.y : 0;
  const yaw = Number.isFinite(tilt?.yaw) ? tilt.yaw : 0;
  switch (exercise?.layout) {
    case 'rail-h':
      return { x, y: 0 };
    case 'rail-v':
      return { x: 0, y };
    case 'arc':
      return { x: yaw, y };
    default:
      return { x, y };
  }
}

/**
 * Normierter Abstand Spieler ↔ Ziel (Schienen: eindimensional).
 * @param {{layout: string}} exercise
 * @param {{x: number, y: number}} player
 * @param {{x: number, y: number}} target
 */
export function trackingDistance(exercise, player, target) {
  switch (exercise?.layout) {
    case 'rail-h':
      return Math.abs(player.x - target.x);
    case 'rail-v':
      return Math.abs(player.y - target.y);
    default:
      return Math.hypot(player.x - target.x, player.y - target.y);
  }
}

/**
 * Deterministischer Pseudozufallsgenerator (mulberry32).
 * @param {number} seed
 * @returns {() => number} Werte in [0, 1)
 */
export function createRandom(seed) {
  let state = (Math.floor(Number(seed) || 0) >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let r = state;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spiellogik für "Tag": Zielpunkte erscheinen nacheinander an zufälligen Positionen und werden
 * gefangen, wenn die Kugel TAG_HOLD_SEC lang ununterbrochen im Toleranzradius bleibt.
 * @param {{toleranceRadius: number, seed?: number, holdSec?: number}} options
 */
export function createTagSession({ toleranceRadius, seed = Date.now(), holdSec = TAG_HOLD_SEC }) {
  const random = createRandom(seed);
  const tolerance = Math.max(0.01, Number(toleranceRadius) || 0.2);
  let previous = { x: 0, y: 0 };
  let target = nextTarget();
  let holdTime = 0;
  let caught = 0;

  function nextTarget() {
    let candidate = { x: 0, y: TAG_MIN_RADIUS };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = TAG_MIN_RADIUS + random() * (TAG_MAX_RADIUS - TAG_MIN_RADIUS);
      candidate = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      if (Math.hypot(candidate.x - previous.x, candidate.y - previous.y) >= TAG_MIN_JUMP) break;
    }
    previous = candidate;
    return candidate;
  }

  return {
    /**
     * @param {number} dt  Sekunden seit dem letzten Frame
     * @param {{x: number, y: number}} player
     * @returns {{caught: boolean, inside: boolean}}
     */
    update(dt, player) {
      const step = Math.max(0, Number(dt) || 0);
      const inside = Math.hypot(player.x - target.x, player.y - target.y) <= tolerance;
      if (!inside) {
        holdTime = 0;
        return { caught: false, inside };
      }
      holdTime += step;
      if (holdTime + 1e-9 >= holdSec) {
        caught += 1;
        holdTime = 0;
        target = nextTarget();
        return { caught: true, inside };
      }
      return { caught: false, inside };
    },
    get target() {
      return target;
    },
    get caught() {
      return caught;
    },
    /** Fortschritt des Haltens 0..1. */
    get holdProgress() {
      return Math.min(1, holdTime / holdSec);
    },
    get toleranceRadius() {
      return tolerance;
    },
  };
}
