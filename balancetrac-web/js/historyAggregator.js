/**
 * historyAggregator.js – Day/Week/Month/Year-Aggregation der gespeicherten Sessions (DOM-frei).
 *
 * Jeder Zeitraum wird in Buckets der nächstkleineren Kalendereinheit zerlegt (lokale Zeit):
 *   DAY   → 24 Stunden
 *   WEEK  → 7 Tage (Montag bis Sonntag, ISO-Woche)
 *   MONTH → alle Tage des Monats
 *   YEAR  → 12 Monate
 * Pro Bucket: Anzahl, Durchschnitt (Average) und Bestwert (Daily Best). Zusätzlich der
 * Allzeit-Bestwert (All Time Best) für den Filter – unabhängig vom gewählten Zeitraum.
 */

import { matchesFilter } from './storage.js';

export const HISTORY_PERIODS = Object.freeze(['DAY', 'WEEK', 'MONTH', 'YEAR']);

const BUCKET_UNIT = Object.freeze({ DAY: 'hour', WEEK: 'day', MONTH: 'day', YEAR: 'month' });

function normalizePeriod(period) {
  return HISTORY_PERIODS.includes(period) ? period : 'WEEK';
}

function toInt(value, fallback = 0) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * Zeitraum (lokale Zeit) samt Buckets. Ende jeweils exklusiv.
 * @param {'DAY'|'WEEK'|'MONTH'|'YEAR'} period
 * @param {number} referenceMillis  Zeitpunkt im "aktuellen" Zeitraum
 * @param {number} [offset=0]       0 = aktueller Zeitraum, -1 = vorheriger, …
 * @returns {{period: string, offset: number, start: number, end: number, buckets: Array<{index: number, start: number, end: number, unit: string}>}}
 */
export function getPeriodRange(period, referenceMillis, offset = 0) {
  const p = normalizePeriod(period);
  const n = toInt(offset);
  const ref = new Date(referenceMillis);
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const d = ref.getDate();
  const buckets = [];
  let start;
  let end;

  switch (p) {
    case 'DAY': {
      start = new Date(y, m, d + n);
      end = new Date(y, m, d + n + 1);
      for (let hour = 0; hour < 24; hour += 1) {
        buckets.push({
          start: new Date(y, m, d + n, hour).getTime(),
          end: hour < 23 ? new Date(y, m, d + n, hour + 1).getTime() : end.getTime(),
        });
      }
      break;
    }
    case 'WEEK': {
      const mondayOffset = (ref.getDay() + 6) % 7;
      const first = d - mondayOffset + 7 * n;
      start = new Date(y, m, first);
      end = new Date(y, m, first + 7);
      for (let day = 0; day < 7; day += 1) {
        buckets.push({ start: new Date(y, m, first + day).getTime(), end: new Date(y, m, first + day + 1).getTime() });
      }
      break;
    }
    case 'MONTH': {
      start = new Date(y, m + n, 1);
      end = new Date(y, m + n + 1, 1);
      const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= days; day += 1) {
        buckets.push({
          start: new Date(start.getFullYear(), start.getMonth(), day).getTime(),
          end: new Date(start.getFullYear(), start.getMonth(), day + 1).getTime(),
        });
      }
      break;
    }
    default: {
      start = new Date(y + n, 0, 1);
      end = new Date(y + n + 1, 0, 1);
      for (let month = 0; month < 12; month += 1) {
        buckets.push({ start: new Date(y + n, month, 1).getTime(), end: new Date(y + n, month + 1, 1).getTime() });
      }
      break;
    }
  }

  return {
    period: p,
    offset: n,
    start: start.getTime(),
    end: end.getTime(),
    buckets: buckets.map((bucket, index) => ({ index, ...bucket, unit: BUCKET_UNIT[p] })),
  };
}

/**
 * Aggregiert Sessions für einen Zeitraum.
 * @param {Array<{timestampMillis: number, score: number}>} sessions
 * @param {{period: string, referenceMillis: number, offset?: number, filter?: object}} options
 */
export function aggregateHistory(sessions, { period, referenceMillis, offset = 0, filter = {} }) {
  const range = getPeriodRange(period, referenceMillis, offset);
  const acc = range.buckets.map(() => ({ count: 0, sum: 0, best: null }));
  let allTimeBest = null;
  let allTimeCount = 0;
  let count = 0;
  let sum = 0;
  let best = null;

  for (const session of sessions ?? []) {
    if (!session || !Number.isFinite(session.score) || !Number.isFinite(session.timestampMillis)) continue;
    if (!matchesFilter(session, filter)) continue;
    allTimeCount += 1;
    if (allTimeBest === null || session.score > allTimeBest) allTimeBest = session.score;

    const ts = session.timestampMillis;
    if (ts < range.start || ts >= range.end) continue;
    const index = range.buckets.findIndex((bucket) => ts >= bucket.start && ts < bucket.end);
    if (index < 0) continue;
    const bucket = acc[index];
    bucket.count += 1;
    bucket.sum += session.score;
    if (bucket.best === null || session.score > bucket.best) bucket.best = session.score;
    count += 1;
    sum += session.score;
    if (best === null || session.score > best) best = session.score;
  }

  return {
    period: range.period,
    offset: range.offset,
    start: range.start,
    end: range.end,
    buckets: range.buckets.map((bucket, index) => ({
      ...bucket,
      count: acc[index].count,
      average: acc[index].count > 0 ? acc[index].sum / acc[index].count : null,
      best: acc[index].best,
    })),
    count,
    average: count > 0 ? sum / count : null,
    best,
    allTimeBest,
    allTimeCount,
  };
}

/**
 * ISO-8601-Kalenderwoche eines Zeitpunkts (lokale Zeit).
 * @param {number} millis
 * @returns {{week: number, year: number}}
 */
export function isoWeek(millis) {
  const date = new Date(millis);
  const day = (date.getDay() + 6) % 7; // Montag = 0
  // Donnerstag derselben Woche bestimmt das ISO-Jahr
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstThursdayDay = (firstThursday.getDay() + 6) % 7;
  const week1Monday = new Date(firstThursday.getFullYear(), 0, 4 - firstThursdayDay);
  const week = 1 + Math.round((new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate() - 3) - week1Monday) / (7 * 86400000));
  return { week, year: thursday.getFullYear() };
}

/**
 * Index des Buckets, der den Zeitpunkt enthält (oder -1).
 * @param {{buckets: Array<{start: number, end: number}>}} aggregation
 * @param {number} millis
 */
export function bucketIndexAt(aggregation, millis) {
  return aggregation.buckets.findIndex((bucket) => millis >= bucket.start && millis < bucket.end);
}
