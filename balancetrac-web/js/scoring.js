/**
 * scoring.js – Reine Scoring-Engine 0–100 für BalanceTrac (DOM-frei, in Node testbar).
 *
 * Tracking-Übungen (Bull's Eye, Side-to-Side, Front To Back, Chase, Orbit CW/CCW, Front/Rear Twist):
 *   Pro Frame wird der normierte Abstand d zwischen Spieler- und Zielkugel bewertet:
 *     d <= toleranceRadius            → 100 % Frame-Score
 *     toleranceRadius < d < 3 · tol   → linear abfallend
 *     d >= 3 · toleranceRadius        → 0 %
 *   End-Score = Durchschnitt aller Frames (0..100).
 *   Optional kann jeder Frame mit seiner Dauer (dt) gewichtet werden; bei konstanter Bildrate ist
 *   das identisch mit dem einfachen Frame-Durchschnitt, bei Rucklern aber fairer.
 *
 * Tag: gefangene Ziele im Zeitlimit, normiert auf den levelabhängigen Zielwert (12 / 15 / 18 Ziele
 *   bezogen auf 30 Sekunden; bei 60 Sekunden verdoppelt sich der Zielwert).
 */

/** Ab diesem Vielfachen des Toleranzradius gibt es 0 Punkte. */
export const TOLERANCE_FALLOFF_FACTOR = 3;

/** Levelabhängiger Zielwert für "Tag" (bezogen auf TAG_REFERENCE_DURATION_SEC). */
export const TAG_TARGETS_BY_LEVEL = Object.freeze({ 1: 12, 2: 15, 3: 18 });
export const TAG_REFERENCE_DURATION_SEC = 30;

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Begrenzt einen Score auf eine ganze Zahl in [0, 100].
 * @param {number} value
 * @returns {number}
 */
export function clampScore(value) {
  const v = finiteOr(value, 0);
  return Math.min(100, Math.max(0, Math.round(v)));
}

/**
 * Frame-Score für einen normierten Abstand.
 * @param {number} distance          normierter Abstand Spieler ↔ Ziel (>= 0)
 * @param {number} toleranceRadius   levelabhängiger Toleranzradius (> 0)
 * @returns {number} 0..1
 */
export function frameScore(distance, toleranceRadius) {
  const d = Math.abs(finiteOr(distance, Number.POSITIVE_INFINITY));
  const tol = finiteOr(toleranceRadius, 0);
  if (!(tol > 0)) return d === 0 ? 1 : 0;
  if (d <= tol) return 1;
  const zeroAt = TOLERANCE_FALLOFF_FACTOR * tol;
  // Kleine Toleranz gegen Rundungsfehler (z. B. 3 · 0.2 = 0.6000000000000001)
  if (d >= zeroAt - 1e-9) return 0;
  return 1 - (d - tol) / (zeroAt - tol);
}

/**
 * Sammelt Frame-Scores einer Tracking-Übung.
 * @returns {{
 *   add: (distance: number, toleranceRadius: number, weight?: number) => number,
 *   reset: () => void,
 *   readonly score: number,
 *   readonly exactScore: number,
 *   readonly frames: number,
 *   readonly totalWeight: number,
 *   readonly timeInTolerance: number,
 * }}
 */
export function createTrackingScorer() {
  let weightedSum = 0;
  let totalWeight = 0;
  let frames = 0;
  let inToleranceWeight = 0;

  return {
    /**
     * Bewertet einen Frame.
     * @param {number} distance
     * @param {number} toleranceRadius
     * @param {number} [weight=1]  z. B. Frame-Dauer dt in Sekunden
     * @returns {number} Frame-Score 0..1
     */
    add(distance, toleranceRadius, weight = 1) {
      const w = finiteOr(weight, 0);
      const value = frameScore(distance, toleranceRadius);
      if (w <= 0) return value;
      weightedSum += value * w;
      totalWeight += w;
      frames += 1;
      if (Math.abs(finiteOr(distance, Number.POSITIVE_INFINITY)) <= finiteOr(toleranceRadius, 0)) {
        inToleranceWeight += w;
      }
      return value;
    },
    reset() {
      weightedSum = 0;
      totalWeight = 0;
      frames = 0;
      inToleranceWeight = 0;
    },
    /** Ganzzahliger Score 0..100 (0, solange noch kein Frame bewertet wurde). */
    get score() {
      return totalWeight > 0 ? clampScore((weightedSum / totalWeight) * 100) : 0;
    },
    /** Ungerundeter Score 0..100. */
    get exactScore() {
      return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
    },
    get frames() {
      return frames;
    },
    get totalWeight() {
      return totalWeight;
    },
    /** Summe der Gewichte (bei dt-Gewichtung: Sekunden) innerhalb des Toleranzradius. */
    get timeInTolerance() {
      return inToleranceWeight;
    },
  };
}

/**
 * Zielwert für "Tag" abhängig von Level und Übungsdauer.
 * @param {number} level 1..3
 * @param {number} [durationSec=30]
 * @returns {number}
 */
export function tagTargetCount(level, durationSec = TAG_REFERENCE_DURATION_SEC) {
  const base = TAG_TARGETS_BY_LEVEL[level] ?? TAG_TARGETS_BY_LEVEL[1];
  const duration = finiteOr(durationSec, TAG_REFERENCE_DURATION_SEC);
  return Math.max(1, Math.round((base * Math.max(0, duration)) / TAG_REFERENCE_DURATION_SEC));
}

/** Labyrinth: 0 Punkte ab diesem Vielfachen der Par-Zeit. */
export const LABYRINTH_ZERO_FACTOR = 3;

/**
 * Labyrinth-Score: 100 bei Zeit <= Par-Zeit, danach linear abnehmend bis 0 bei 3 × Par-Zeit.
 * @param {number} timeSec
 * @param {number} parSec
 * @returns {number} 0..100
 */
export function labyrinthScore(timeSec, parSec) {
  const time = finiteOr(timeSec, Number.POSITIVE_INFINITY);
  const par = finiteOr(parSec, 0);
  if (!(par > 0) || time < 0) return 0;
  if (time <= par) return 100;
  const zeroAt = LABYRINTH_ZERO_FACTOR * par;
  if (time >= zeroAt) return 0;
  return clampScore(100 * (1 - (time - par) / (zeroAt - par)));
}

/**
 * Astro Guard: Punkte, die 100 ergeben (entspricht zwei vollständig abgeräumten Wellen des Levels).
 * Level 1: 8 × (30 + 20 + 20 + 10) = 640 je Welle; Level 2: 9 × 90 = 810; Level 3: 10 × 90 = 900.
 */
export const ASTRO_GUARD_REFERENCE_POINTS = Object.freeze({ 1: 1280, 2: 1620, 3: 1800 });

/**
 * Normierter Astro-Guard-Score.
 * @param {number} points  erspielte Punkte (Highscore-Rohwert)
 * @param {number} level   1..3
 * @returns {number} 0..100
 */
export function astroGuardScore(points, level) {
  const reference = ASTRO_GUARD_REFERENCE_POINTS[level] ?? ASTRO_GUARD_REFERENCE_POINTS[1];
  return clampScore((Math.max(0, finiteOr(points, 0)) / reference) * 100);
}

/**
 * Score für "Tag".
 * @param {number} caught  gefangene Ziele
 * @param {number} level   1..3
 * @param {number} [durationSec=30]
 * @returns {number} 0..100
 */
export function tagScore(caught, level, durationSec = TAG_REFERENCE_DURATION_SEC) {
  const count = Math.max(0, Math.floor(finiteOr(caught, 0)));
  return clampScore((count / tagTargetCount(level, durationSec)) * 100);
}
