/**
 * config.js – Zentrale Konfiguration für BalanceTrac.
 *
 * Enthält BOARD_CONFIG (Level 1–3), Board-Profile, Standard-Einstellungen sowie einen
 * kleinen Settings-Store mit localStorage-Persistenz. Das Modul greift nicht auf das DOM zu;
 * der Speicher wird injiziert (Standard: globalThis.localStorage, sofern verfügbar).
 */

import { MEASURE_EXERCISE_IDS } from './exercises.js';
import { SUPPORTED_LANGUAGES } from './i18n.js';

export const APP_VERSION = '1.0.0';
export const SETTINGS_STORAGE_KEY = 'balancetrac_settings_v1';
export const SETTINGS_SCHEMA_VERSION = 1;

export const MODES = Object.freeze(['PLAY', 'TRAIN', 'MEASURE']);
export const LEVELS = Object.freeze([1, 2, 3]);

/** Empfindlichkeit je Hardware-Level (Anzahl Gummi-Höhenpads unter dem Board). */
export const BOARD_CONFIG = Object.freeze({
  1: Object.freeze({ level: 1, pads: 1, maxTiltDeg: 10, maxYawDeg: 15, targetSpeedMultiplier: 0.75, toleranceRadius: 0.22 }),
  2: Object.freeze({ level: 2, pads: 2, maxTiltDeg: 15, maxYawDeg: 22, targetSpeedMultiplier: 1.0, toleranceRadius: 0.16 }),
  3: Object.freeze({ level: 3, pads: 3, maxTiltDeg: 20, maxYawDeg: 30, targetSpeedMultiplier: 1.3, toleranceRadius: 0.12 }),
});

/** Zulässige Bereiche für benutzerdefinierte Level-Werte (Einstellungsmenü). */
export const LEVEL_OVERRIDE_LIMITS = Object.freeze({
  maxTiltDeg: Object.freeze({ min: 3, max: 45 }),
  maxYawDeg: Object.freeze({ min: 5, max: 90 }),
  targetSpeedMultiplier: Object.freeze({ min: 0.25, max: 3 }),
  toleranceRadius: Object.freeze({ min: 0.03, max: 0.6 }),
});

export const EMA_ALPHA_LIMITS = Object.freeze({ min: 0.05, max: 1 });
export const DEADZONE_LIMITS = Object.freeze({ min: 0, max: 3 });

/** Wählbare Übungsdauer im Measure-Modul (Sekunden). */
export const MEASURE_DURATIONS = Object.freeze([30, 60]);
/** Aufsteig-Countdown vor jeder Übung (Sekunden). */
export const MOUNT_COUNTDOWN_LIMITS = Object.freeze({ min: 3, max: 5 });
/** Schussmodus in Astro Guard: automatisch oder durch leichtes Vorwärts-Kippen. */
export const SHOOTER_FIRE_MODES = Object.freeze(['auto', 'pitch']);
/** Train-Zirkel: Gesamtdauer in Minuten. */
export const TRAIN_MINUTES_LIMITS = Object.freeze({ min: 2, max: 30 });

/**
 * Board-Profile für das Karussell. Weitere Profile (z. B. ein Edge-Board) werden hier
 * ergänzt und in icons.js über `shape` gezeichnet.
 */
export const BOARD_PROFILES = Object.freeze([
  Object.freeze({ id: 'M_PAD', nameKey: 'board.M_PAD', shape: 'mpad', supportsYaw: true }),
]);
export const DEFAULT_BOARD_PROFILE_ID = 'M_PAD';

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  language: null,
  emaAlpha: 0.25,
  deadzoneDeg: 0.3,
  invertX: false,
  invertY: false,
  invertYaw: false,
  levelOverrides: Object.freeze({}),
  simulatorEnabled: false,
  lastMode: 'MEASURE',
  lastLevel: 1,
  boardProfileId: DEFAULT_BOARD_PROFILE_ID,
  calibration: null,
  soundEnabled: true,
  voiceEnabled: false,
  measureDurationSec: 30,
  mountCountdownSec: 5,
  shooterFireMode: 'auto',
  trainExercises: MEASURE_EXERCISE_IDS,
  trainMinutes: 10,
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value, limits, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, value));
}

/**
 * @param {unknown} level
 * @returns {1|2|3}
 */
export function normalizeLevel(level) {
  const n = Number(level);
  return /** @type {1|2|3} */ (LEVELS.includes(n) ? n : 1);
}

function sanitizeOverrideEntry(entry) {
  if (!isPlainObject(entry)) return {};
  const result = {};
  for (const [field, limits] of Object.entries(LEVEL_OVERRIDE_LIMITS)) {
    const value = entry[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[field] = Math.min(limits.max, Math.max(limits.min, value));
    }
  }
  return result;
}

/**
 * Bereinigt benutzerdefinierte Level-Werte: nur bekannte Level/Felder, Werte begrenzt.
 * @param {unknown} overrides
 * @returns {Record<string, Partial<Record<keyof typeof LEVEL_OVERRIDE_LIMITS, number>>>}
 */
export function sanitizeLevelOverrides(overrides) {
  const result = {};
  if (!isPlainObject(overrides)) return result;
  for (const level of LEVELS) {
    const entry = sanitizeOverrideEntry(overrides[level] ?? overrides[String(level)]);
    if (Object.keys(entry).length > 0) result[String(level)] = entry;
  }
  return result;
}

function sanitizeCalibration(value) {
  if (!isPlainObject(value)) return null;
  const zeroRoll = value.zeroRoll;
  const zeroPitch = value.zeroPitch;
  if (typeof zeroRoll !== 'number' || !Number.isFinite(zeroRoll)) return null;
  if (typeof zeroPitch !== 'number' || !Number.isFinite(zeroPitch)) return null;
  if (Math.abs(zeroRoll) > 90 || Math.abs(zeroPitch) > 90) return null;
  const timestampMillis = typeof value.timestampMillis === 'number' && Number.isFinite(value.timestampMillis)
    ? value.timestampMillis
    : 0;
  return { zeroRoll, zeroPitch, timestampMillis };
}

/**
 * Vervollständigt und validiert ein (eventuell fremdes oder veraltetes) Settings-Objekt.
 * @param {unknown} input
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function sanitizeSettings(input) {
  const src = isPlainObject(input) ? input : {};
  const d = DEFAULT_SETTINGS;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    language: typeof src.language === 'string' && SUPPORTED_LANGUAGES.includes(src.language) ? src.language : null,
    emaAlpha: clampNumber(src.emaAlpha, EMA_ALPHA_LIMITS, d.emaAlpha),
    deadzoneDeg: clampNumber(src.deadzoneDeg, DEADZONE_LIMITS, d.deadzoneDeg),
    invertX: src.invertX === true,
    invertY: src.invertY === true,
    invertYaw: src.invertYaw === true,
    levelOverrides: sanitizeLevelOverrides(src.levelOverrides),
    simulatorEnabled: src.simulatorEnabled === true,
    lastMode: MODES.includes(src.lastMode) ? src.lastMode : d.lastMode,
    lastLevel: normalizeLevel(src.lastLevel),
    boardProfileId: BOARD_PROFILES.some((profile) => profile.id === src.boardProfileId)
      ? src.boardProfileId
      : d.boardProfileId,
    calibration: sanitizeCalibration(src.calibration),
    soundEnabled: typeof src.soundEnabled === 'boolean' ? src.soundEnabled : d.soundEnabled,
    voiceEnabled: src.voiceEnabled === true,
    measureDurationSec: MEASURE_DURATIONS.includes(src.measureDurationSec) ? src.measureDurationSec : d.measureDurationSec,
    mountCountdownSec: Math.round(clampNumber(src.mountCountdownSec, MOUNT_COUNTDOWN_LIMITS, d.mountCountdownSec)),
    shooterFireMode: SHOOTER_FIRE_MODES.includes(src.shooterFireMode) ? src.shooterFireMode : d.shooterFireMode,
    trainExercises: Array.isArray(src.trainExercises)
      ? MEASURE_EXERCISE_IDS.filter((id) => src.trainExercises.includes(id))
      : [...d.trainExercises],
    trainMinutes: Math.round(clampNumber(src.trainMinutes, TRAIN_MINUTES_LIMITS, d.trainMinutes)),
  };
}

/**
 * Liefert die wirksame Konfiguration eines Levels (BOARD_CONFIG + benutzerdefinierte Werte).
 * @param {unknown} level
 * @param {{levelOverrides?: unknown}} [settings]
 */
export function getLevelConfig(level, settings) {
  const lvl = normalizeLevel(level);
  const overrides = isPlainObject(settings?.levelOverrides) ? settings.levelOverrides : {};
  const entry = sanitizeOverrideEntry(overrides[lvl] ?? overrides[String(lvl)]);
  return Object.freeze({ ...BOARD_CONFIG[lvl], ...entry });
}

/**
 * @param {string} id
 */
export function getBoardProfile(id) {
  return BOARD_PROFILES.find((profile) => profile.id === id) ?? BOARD_PROFILES[0];
}

/**
 * Liefert localStorage, falls nutzbar (im privaten Modus kann der Zugriff werfen), sonst null.
 * @returns {Storage | null}
 */
export function getDefaultStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probeKey = '__balancetrac_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

/**
 * @param {Pick<Storage, 'getItem'> | null} storage
 */
export function loadSettings(storage) {
  if (!storage) return sanitizeSettings({});
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitizeSettings({});
  }
}

/**
 * @param {unknown} settings
 * @param {Pick<Storage, 'setItem'> | null} storage
 * @returns {boolean} true bei erfolgreichem Speichern
 */
export function saveSettings(settings, storage) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Kleiner reaktiver Settings-Store mit Persistenz.
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} [storage]
 */
export function createSettingsStore(storage = getDefaultStorage()) {
  let state = Object.freeze(loadSettings(storage));
  const listeners = new Set();

  function commit(next) {
    const previous = state;
    state = Object.freeze(next);
    saveSettings(state, storage);
    for (const listener of listeners) listener(state, previous);
    return state;
  }

  return {
    /** @returns {Readonly<typeof DEFAULT_SETTINGS>} */
    get: () => state,
    /**
     * @param {object | ((current: typeof DEFAULT_SETTINGS) => object)} patch
     */
    update(patch) {
      const partial = typeof patch === 'function' ? patch(state) : patch;
      return commit(sanitizeSettings({ ...state, ...partial }));
    },
    reset() {
      return commit(sanitizeSettings({}));
    },
    /**
     * @param {(next: typeof DEFAULT_SETTINGS, previous: typeof DEFAULT_SETTINGS) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
