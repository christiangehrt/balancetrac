/**
 * storage.js – Session-Repository (localStorage) + JSON-Export/Import für BalanceTrac.
 *
 * Jeder Datensatz liegt in localStorage unter "balancetrac_sessions_v1":
 *   { id, timestampMillis, deviceId, mode, activityId, level, durationSec, rawValue, score }
 *
 * Die Repository-Logik ist DOM-frei (Speicher wird injiziert) und in Node testbar.
 * Nur downloadBackup()/readBackupFile() nutzen Browser-APIs – und zwar erst beim Aufruf.
 */

import { getDefaultStorage } from './config.js';

export const SESSIONS_STORAGE_KEY = 'balancetrac_sessions_v1';
export const BACKUP_SCHEMA = 'balancetrac-backup';
export const BACKUP_VERSION = 1;
export const SESSION_MODES = Object.freeze(['MEASURE', 'TRAIN', 'PLAY']);
export const DEFAULT_DEVICE_ID = 'M_PAD';

const CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Erzeugt eine Session-ID im Format "<timestampMillis>-<6 Zeichen>".
 * @param {number} timestampMillis
 * @param {() => number} [random]
 */
export function createSessionId(timestampMillis, random = Math.random) {
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')
    .slice(-6);
  return `${Math.round(timestampMillis)}-${suffix}`;
}

/**
 * Prüft und normiert einen Datensatz (Schema-Validierung).
 * Pflichtfelder: timestampMillis, mode, activityId, level, durationSec, rawValue, score.
 * Optional: id (wird sonst erzeugt), deviceId (Standard "M_PAD").
 * @param {unknown} input
 * @param {{random?: () => number}} [options]
 * @returns {{id: string, timestampMillis: number, deviceId: string, mode: string, activityId: string, level: number, durationSec: number, rawValue: number, score: number} | null}
 */
export function normalizeSession(input, { random = Math.random } = {}) {
  if (!isPlainObject(input)) return null;
  const { timestampMillis, mode, activityId, level, durationSec, rawValue, score } = input;
  if (!isFiniteNumber(timestampMillis) || timestampMillis <= 0) return null;
  if (!SESSION_MODES.includes(mode)) return null;
  if (typeof activityId !== 'string' || !CODE_PATTERN.test(activityId)) return null;
  if (level !== 1 && level !== 2 && level !== 3) return null;
  if (!isFiniteNumber(durationSec) || durationSec < 0) return null;
  if (!isFiniteNumber(rawValue)) return null;
  if (!isFiniteNumber(score) || score < 0 || score > 100) return null;
  const deviceId = input.deviceId === undefined ? DEFAULT_DEVICE_ID : input.deviceId;
  if (typeof deviceId !== 'string' || !CODE_PATTERN.test(deviceId)) return null;
  const id = typeof input.id === 'string' && SESSION_ID_PATTERN.test(input.id) ? input.id : createSessionId(timestampMillis, random);
  return {
    id,
    timestampMillis: Math.round(timestampMillis),
    deviceId,
    mode,
    activityId,
    level,
    durationSec: Math.round(durationSec * 10) / 10,
    rawValue: Math.round(rawValue * 100) / 100,
    score: Math.round(score),
  };
}

/**
 * true, wenn beide Zeitpunkte am selben lokalen Kalendertag liegen.
 * @param {number} a
 * @param {number} b
 */
export function isSameLocalDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/**
 * @param {object} session
 * @param {{deviceId?: string, mode?: string, activityId?: string, level?: number, from?: number, to?: number}} [filter]
 */
export function matchesFilter(session, filter = {}) {
  for (const key of ['deviceId', 'mode', 'activityId', 'level']) {
    if (filter[key] !== undefined && filter[key] !== null && session[key] !== filter[key]) return false;
  }
  if (isFiniteNumber(filter.from) && session.timestampMillis < filter.from) return false;
  if (isFiniteNumber(filter.to) && session.timestampMillis > filter.to) return false;
  return true;
}

/**
 * Tages- und Allzeit-Bestwert für einen Filter.
 * @param {object[]} sessions
 * @param {object} filter
 * @param {number} referenceMillis  Zeitpunkt, dessen Kalendertag als "heute" gilt
 * @returns {{dailyBest: number|null, allTimeBest: number|null, count: number}}
 */
export function computeBests(sessions, filter, referenceMillis) {
  let dailyBest = null;
  let allTimeBest = null;
  let count = 0;
  for (const session of sessions) {
    if (!matchesFilter(session, filter)) continue;
    count += 1;
    if (allTimeBest === null || session.score > allTimeBest) allTimeBest = session.score;
    if (isSameLocalDay(session.timestampMillis, referenceMillis) && (dailyBest === null || session.score > dailyBest)) {
      dailyBest = session.score;
    }
  }
  return { dailyBest, allTimeBest, count };
}

/**
 * Prüft eine Backup-Datei. Akzeptiert das BalanceTrac-Backup-Format oder ein reines Session-Array.
 * @param {unknown} data
 * @returns {{ok: true, sessions: object[], skipped: number} | {ok: false, error: 'invalidFormat'|'unsupportedVersion'|'noValidSessions', sessions: [], skipped: number}}
 */
export function validateBackup(data) {
  let list;
  if (Array.isArray(data)) {
    list = data;
  } else if (isPlainObject(data) && data.schema === BACKUP_SCHEMA && Array.isArray(data.sessions)) {
    if (isFiniteNumber(data.version) && data.version > BACKUP_VERSION) {
      return { ok: false, error: 'unsupportedVersion', sessions: [], skipped: 0 };
    }
    list = data.sessions;
  } else {
    return { ok: false, error: 'invalidFormat', sessions: [], skipped: 0 };
  }

  const sessions = [];
  const seen = new Set();
  let skipped = 0;
  for (const item of list) {
    const session = normalizeSession(item);
    if (!session || seen.has(session.id)) {
      skipped += 1;
      continue;
    }
    seen.add(session.id);
    sessions.push(session);
  }
  if (list.length > 0 && sessions.length === 0) {
    return { ok: false, error: 'noValidSessions', sessions: [], skipped };
  }
  return { ok: true, sessions, skipped };
}

/**
 * Dateiname für den Export: balancetrac-backup-YYYY-MM-DD.json (lokales Datum).
 * @param {Date} [date]
 */
export function backupFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `balancetrac-backup-${y}-${m}-${d}.json`;
}

const byTimestamp = (a, b) => a.timestampMillis - b.timestampMillis || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Session-Repository über einem Storage-Adapter (getItem/setItem).
 * @param {Pick<Storage, 'getItem'|'setItem'> | null} [storage]
 * @param {{now?: () => number, random?: () => number}} [options]
 */
export function createSessionRepository(storage = getDefaultStorage(), { now = () => Date.now(), random = Math.random } = {}) {
  /** @type {object[] | null} */
  let cache = null;
  const listeners = new Set();

  function load() {
    if (cache) return cache;
    let parsed = [];
    if (storage) {
      try {
        const raw = storage.getItem(SESSIONS_STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : [];
        if (Array.isArray(data)) parsed = data;
      } catch {
        parsed = [];
      }
    }
    const seen = new Set();
    cache = [];
    for (const item of parsed) {
      const session = normalizeSession(item, { random });
      if (session && !seen.has(session.id)) {
        seen.add(session.id);
        cache.push(session);
      }
    }
    cache.sort(byTimestamp);
    return cache;
  }

  /** @returns {boolean} false, wenn der Speicher voll oder nicht verfügbar ist */
  function persist(next) {
    if (storage) {
      try {
        storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        return false;
      }
    }
    cache = next;
    for (const listener of listeners) listener(cache);
    return true;
  }

  return {
    /** @returns {object[]} alle Sessions, chronologisch sortiert (Kopie) */
    getAll() {
      return load().slice();
    },

    /**
     * Speichert eine neue Session (id und timestampMillis werden bei Bedarf ergänzt).
     * @param {object} input
     * @returns {{ok: true, session: object} | {ok: false, error: 'invalid'|'storageFull'}}
     */
    add(input) {
      const session = normalizeSession(
        { timestampMillis: now(), deviceId: DEFAULT_DEVICE_ID, ...input },
        { random },
      );
      if (!session) return { ok: false, error: 'invalid' };
      const current = load();
      if (current.some((existing) => existing.id === session.id)) {
        session.id = createSessionId(session.timestampMillis, random);
      }
      const next = [...current, session].sort(byTimestamp);
      return persist(next) ? { ok: true, session } : { ok: false, error: 'storageFull' };
    },

    /** @param {object} [filter] */
    query(filter = {}) {
      return load().filter((session) => matchesFilter(session, filter));
    },

    /**
     * @param {object} filter
     * @param {number} [referenceMillis]
     */
    getBests(filter, referenceMillis = now()) {
      return computeBests(load(), filter, referenceMillis);
    },

    /** Löscht alle Sessions. */
    clear() {
      return persist([]);
    },

    /**
     * Komplettes Backup-Objekt.
     * @param {number} [exportedAtMillis]
     */
    exportBackup(exportedAtMillis = now()) {
      return {
        app: 'BalanceTrac',
        schema: BACKUP_SCHEMA,
        version: BACKUP_VERSION,
        exportedAt: new Date(exportedAtMillis).toISOString(),
        sessions: load().map((session) => ({ ...session })),
      };
    },

    /**
     * Importiert ein Backup.
     *  merge   – vorhandene Sessions bleiben, Duplikate (gleiche id) werden übersprungen
     *  replace – die Historie wird vollständig durch das Backup ersetzt
     * @param {unknown} data
     * @param {{strategy?: 'merge'|'replace'}} [options]
     */
    importBackup(data, { strategy = 'merge' } = {}) {
      const result = validateBackup(data);
      if (!result.ok) return { ok: false, error: result.error, added: 0, duplicates: 0, skipped: result.skipped, total: load().length };
      let next;
      let added = 0;
      let duplicates = 0;
      if (strategy === 'replace') {
        next = result.sessions.slice();
        added = next.length;
      } else {
        const existingIds = new Set(load().map((session) => session.id));
        next = load().slice();
        for (const session of result.sessions) {
          if (existingIds.has(session.id)) {
            duplicates += 1;
          } else {
            next.push(session);
            added += 1;
          }
        }
      }
      next.sort(byTimestamp);
      if (!persist(next)) {
        return { ok: false, error: 'storageFull', added: 0, duplicates, skipped: result.skipped, total: load().length };
      }
      return { ok: true, added, duplicates, skipped: result.skipped, total: next.length };
    },

    /**
     * @param {(sessions: object[]) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Serialisiert ein Backup lesbar formatiert.
 * @param {object} backup
 */
export function serializeBackup(backup) {
  return JSON.stringify(backup, null, 2);
}

/**
 * Startet den Download des Backups als JSON-Datei (Browser).
 * @param {ReturnType<typeof createSessionRepository>} repository
 * @param {{date?: Date}} [options]
 * @returns {string} Dateiname
 */
export function downloadBackup(repository, { date = new Date() } = {}) {
  const fileName = backupFileName(date);
  const blob = new Blob([serializeBackup(repository.exportBackup(date.getTime()))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return fileName;
}

/**
 * Liest eine hochgeladene Backup-Datei (Browser).
 * @param {Blob} file
 * @returns {Promise<unknown>} geparstes JSON (Validierung über importBackup/validateBackup)
 */
export async function readBackupFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}
