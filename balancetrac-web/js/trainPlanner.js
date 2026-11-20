/**
 * trainPlanner.js – Planung des Hands-Free-Zirkels (DOM-frei, in Node testbar).
 *
 * Die Gesamtdauer (2–30 min) wird auf Stationen von 45–60 s verteilt; zwischen den Stationen liegt
 * jeweils eine 10-Sekunden-Pause, die in der Gesamtdauer enthalten ist. Die gewählten Übungen werden
 * der Reihe nach wiederholt, bis alle Stationen belegt sind.
 */

import { MEASURE_EXERCISE_IDS } from './exercises.js';

export const TRAIN_MIN_MINUTES = 2;
export const TRAIN_MAX_MINUTES = 30;
export const TRAIN_DEFAULT_MINUTES = 10;
export const TRAIN_PAUSE_SEC = 10;
export const STATION_MIN_SEC = 45;
export const STATION_MAX_SEC = 60;
export const STATION_TARGET_SEC = 52;

/** Die drei Schnell-Presets. */
export const TRAIN_PRESETS = Object.freeze([
  Object.freeze({
    id: 'CORE',
    nameKey: 'train.preset.CORE',
    exercises: Object.freeze(['BULLS_EYE', 'ORBIT_CW', 'ORBIT_CCW', 'FRONT_TWIST', 'REAR_TWIST']),
  }),
  Object.freeze({
    id: 'STABILITY',
    nameKey: 'train.preset.STABILITY',
    exercises: Object.freeze(['BULLS_EYE', 'SIDE_TO_SIDE', 'FRONT_TO_BACK', 'CHASE']),
  }),
  Object.freeze({
    id: 'FULL_BODY',
    nameKey: 'train.preset.FULL_BODY',
    exercises: MEASURE_EXERCISE_IDS,
  }),
]);

export const TRAIN_DEFAULT_EXERCISES = TRAIN_PRESETS[2].exercises;

/**
 * Begrenzt die Dauer auf ganze Minuten zwischen 2 und 30.
 * @param {unknown} minutes
 */
export function clampMinutes(minutes) {
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n)) return TRAIN_DEFAULT_MINUTES;
  return Math.min(TRAIN_MAX_MINUTES, Math.max(TRAIN_MIN_MINUTES, n));
}

/**
 * Gültige, eindeutige Übungs-IDs in der Reihenfolge der Measure-Übersicht.
 * @param {unknown} ids
 * @returns {string[]}
 */
export function normalizeSelection(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return MEASURE_EXERCISE_IDS.filter((id) => wanted.has(id));
}

/**
 * Preset, das genau der Auswahl entspricht (oder null).
 * @param {string[]} selection
 */
export function matchPreset(selection) {
  const normalized = normalizeSelection(selection);
  const preset = TRAIN_PRESETS.find(
    (candidate) =>
      candidate.exercises.length === normalized.length && candidate.exercises.every((id, index) => normalized[index] === id),
  );
  return preset ? preset.id : null;
}

/**
 * Anzahl der Stationen, sodass jede Station 45–60 s dauert (Ziel ≈ 52 s).
 * @param {number} totalSec  Gesamtdauer inkl. Pausen
 * @param {number} [pauseSec]
 */
export function stationCount(totalSec, pauseSec = TRAIN_PAUSE_SEC) {
  const total = Math.max(0, Number(totalSec) || 0);
  const work = (count) => (total - (count - 1) * pauseSec) / count;
  let count = Math.max(1, Math.round((total + pauseSec) / (STATION_TARGET_SEC + pauseSec)));
  while (count > 1 && work(count) < STATION_MIN_SEC) count -= 1;
  while (work(count) > STATION_MAX_SEC) count += 1;
  return count;
}

/**
 * Plant den Zirkel.
 * @param {string[]} exerciseIds  gewählte Übungen
 * @param {number} minutes        Gesamtdauer in Minuten (2–30)
 * @returns {{totalSec: number, pauseSec: number, workSec: number, stations: Array<{index: number, exerciseId: string, workSec: number}>} | null}
 */
export function planCircuit(exerciseIds, minutes) {
  const selection = normalizeSelection(exerciseIds);
  if (selection.length === 0) return null;
  const totalSec = clampMinutes(minutes) * 60;
  const count = stationCount(totalSec);
  const workTotal = totalSec - (count - 1) * TRAIN_PAUSE_SEC;
  const base = Math.floor(workTotal / count);
  const remainder = workTotal - base * count;
  const stations = [];
  for (let index = 0; index < count; index += 1) {
    stations.push({
      index,
      exerciseId: selection[index % selection.length],
      workSec: base + (index < remainder ? 1 : 0),
    });
  }
  return { totalSec, pauseSec: TRAIN_PAUSE_SEC, workSec: workTotal, stations };
}

/**
 * Durchschnittsscore des Zirkels (gerundet, 0..100).
 * @param {number[]} scores
 */
export function circuitScore(scores) {
  const valid = (scores ?? []).filter((score) => Number.isFinite(score));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, score) => sum + score, 0) / valid.length);
}
