/**
 * activities.js – Katalog aller Aktivitäten, die als Session gespeichert werden (DOM-frei).
 * Reihenfolge = Reihenfolge im Aktivitäts-Filter der History.
 */

import { MEASURE_EXERCISES } from './exercises.js';

export const ACTIVITIES = Object.freeze([
  ...MEASURE_EXERCISES.map((exercise) =>
    Object.freeze({ id: exercise.id, mode: 'MEASURE', nameKey: `exercise.${exercise.id}.name` }),
  ),
  Object.freeze({ id: 'LABYRINTH', mode: 'PLAY', nameKey: 'activity.LABYRINTH.name' }),
  Object.freeze({ id: 'ASTRO_GUARD', mode: 'PLAY', nameKey: 'activity.ASTRO_GUARD.name' }),
  Object.freeze({ id: 'TRAIN_CIRCUIT', mode: 'TRAIN', nameKey: 'activity.TRAIN_CIRCUIT.name' }),
]);

export const ACTIVITY_IDS = Object.freeze(ACTIVITIES.map((activity) => activity.id));

/**
 * @param {string} id
 * @returns {(typeof ACTIVITIES)[number] | null}
 */
export function getActivity(id) {
  return ACTIVITIES.find((activity) => activity.id === id) ?? null;
}
