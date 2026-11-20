/**
 * sensorMath.js – Reine Sensor-Mathematik für BalanceTrac.
 *
 * DOM-frei: keinerlei Zugriff auf window/document, damit das Modul direkt mit
 * `node --test` geprüft werden kann.
 *
 * DeviceOrientation-Konvention (W3C):
 *   alpha  0..360°  Drehung um die Z-Achse (Bildschirmnormale), gegen den Uhrzeigersinn steigend
 *   beta  -180..180° Drehung um die X-Achse; > 0, wenn die Oberkante (Hochformat) angehoben wird
 *   gamma  -90..90°  Drehung um die Y-Achse; > 0, wenn die rechte Kante (Hochformat) absinkt
 *
 * Board-Konvention (Sicht des Nutzers, der auf dem Board steht und auf das
 * flach liegende Display im Querformat schaut):
 *   rollDeg  > 0  rechte Board-Seite sinkt                     → TiltState.x > 0 (Kugel nach rechts)
 *   pitchDeg > 0  vordere Kante (obere Bildschirmkante) sinkt  → TiltState.y > 0 (Kugel nach oben)
 *   yawDeg        Drehwinkel 0..360°, im Uhrzeigersinn (von oben) steigend
 *                 → relativer Yaw > 0 bei Drehung im Uhrzeigersinn
 */

/** Standardwerte der Verarbeitungspipeline (werden von config.js überschrieben). */
export const DEFAULT_PROCESSING_CONFIG = Object.freeze({
  emaAlpha: 0.25,
  deadzoneDeg: 0.3,
  invertX: false,
  invertY: false,
  invertYaw: false,
  maxTiltDeg: 10,
  maxYawDeg: 15,
});

/** Neutraler TiltState (Board waagerecht, keine Drehung). */
export const ZERO_TILT_STATE = Object.freeze({
  x: 0,
  y: 0,
  yaw: 0,
  rawRoll: 0,
  rawPitch: 0,
  rawYaw: 0,
  absRoll: 0,
  absPitch: 0,
  absYaw: 0,
});

/** Anzahl der letzten Messwerte, deren Mittelwert beim Kalibrieren als Nullpunkt dient. */
export const DEFAULT_CALIBRATION_WINDOW = 8;

/**
 * Wandelt einen Wert in eine endliche Zahl um (null, undefined, NaN, ±Infinity → fallback).
 * @param {unknown} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Begrenzt einen Wert auf [min, max]. NaN wird auf min gesetzt.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value)) + 0;
}

/**
 * Normiert einen Winkel auf [0, 360).
 * @param {number} deg
 * @returns {number}
 */
export function normalizeAngle360(deg) {
  const value = toFiniteNumber(deg);
  let result = value % 360;
  if (result < 0) result += 360;
  if (result >= 360) result = 0;
  return result + 0;
}

/**
 * Kürzester vorzeichenbehafteter Winkelabstand von `reference` zu `target`
 * im Bereich [-180, 180). Entspricht der Spezifikation
 *   relYaw = ((yaw - zeroYaw + 540) % 360) - 180
 * ist aber zusätzlich robust gegenüber Eingaben außerhalb von [0, 360).
 * Verhindert Sprünge an der 0°/360°-Grenze (z. B. 359° → 1° ergibt +2°, nicht -358°).
 * @param {number} target
 * @param {number} reference
 * @returns {number}
 */
export function shortestAngleDelta(target, reference) {
  return normalizeAngle360(toFiniteNumber(target) - toFiniteNumber(reference) + 540) - 180;
}

/**
 * Rastet einen Bildschirm-Orientierungswinkel auf 0, 90, 180 oder 270 ein
 * (-90 → 270, 85 → 90, ungültig → 0).
 * @param {unknown} angle
 * @returns {0|90|180|270}
 */
export function normalizeScreenAngle(angle) {
  const normalized = normalizeAngle360(toFiniteNumber(angle, 0));
  const snapped = (Math.round(normalized / 90) * 90) % 360;
  return /** @type {0|90|180|270} */ (snapped + 0);
}

/**
 * Bildet die Rohwerte des DeviceOrientation-Events abhängig von der
 * Bildschirmausrichtung auf die Board-Achsen ab.
 *
 *  90°  (Querformat, Geräte-Oberkante zeigt nach links):  roll =  beta,  pitch =  gamma
 *  270° (Querformat, Geräte-Oberkante zeigt nach rechts): roll = -beta,  pitch = -gamma
 *  0°   (Hochformat, Fallback):                           roll =  gamma, pitch = -beta
 *  180° (Hochformat kopfüber):                            roll = -gamma, pitch =  beta
 *
 * @param {{alpha?: number|null, beta?: number|null, gamma?: number|null}} orientation
 * @param {number} screenAngle  screen.orientation.angle (0, 90, 180, 270 oder -90)
 * @returns {{rollDeg: number, pitchDeg: number, yawDeg: number}}
 */
export function mapOrientationToBoard(orientation, screenAngle) {
  const beta = toFiniteNumber(orientation?.beta);
  const gamma = toFiniteNumber(orientation?.gamma);
  const alpha = toFiniteNumber(orientation?.alpha);

  let rollDeg;
  let pitchDeg;
  switch (normalizeScreenAngle(screenAngle)) {
    case 90:
      rollDeg = beta;
      pitchDeg = gamma;
      break;
    case 270:
      rollDeg = -beta;
      pitchDeg = -gamma;
      break;
    case 180:
      rollDeg = -gamma;
      pitchDeg = beta;
      break;
    default:
      rollDeg = gamma;
      pitchDeg = -beta;
      break;
  }

  return {
    rollDeg: rollDeg + 0,
    pitchDeg: pitchDeg + 0,
    // alpha steigt gegen den Uhrzeigersinn → für "im Uhrzeigersinn positiv" spiegeln
    yawDeg: normalizeAngle360(-alpha),
  };
}

/**
 * Exponentieller Tiefpassfilter (EMA): filtered = alpha * raw + (1 - alpha) * previous.
 * @param {number} previous
 * @param {number} raw
 * @param {number} alpha  Glättungsfaktor (0, 1]; 1 = ungefiltert
 * @returns {number}
 */
export function applyEma(previous, raw, alpha) {
  const a = clamp(toFiniteNumber(alpha, DEFAULT_PROCESSING_CONFIG.emaAlpha), 0.01, 1);
  return a * toFiniteNumber(raw) + (1 - a) * toFiniteNumber(previous);
}

/**
 * Deadzone: Beträge unterhalb der Schwelle werden auf 0 gesetzt.
 * @param {number} value
 * @param {number} deadzone
 * @returns {number}
 */
export function applyDeadzone(value, deadzone) {
  const v = toFiniteNumber(value);
  return Math.abs(v) < Math.max(0, toFiniteNumber(deadzone)) ? 0 : v + 0;
}

/**
 * Normiert einen Winkel auf [-1, +1] bezogen auf den maximalen Ausschlag.
 * @param {number} deg
 * @param {number} maxDeg
 * @returns {number}
 */
export function normalizeAxis(deg, maxDeg) {
  const max = toFiniteNumber(maxDeg);
  if (!(max > 0)) return 0;
  return clamp(toFiniteNumber(deg) / max, -1, 1);
}

/**
 * Vervollständigt und begrenzt eine Verarbeitungs-Konfiguration.
 * @param {Partial<typeof DEFAULT_PROCESSING_CONFIG>} [config]
 * @returns {typeof DEFAULT_PROCESSING_CONFIG}
 */
export function sanitizeProcessingConfig(config) {
  const c = config ?? {};
  const d = DEFAULT_PROCESSING_CONFIG;
  const maxTilt = toFiniteNumber(c.maxTiltDeg, d.maxTiltDeg);
  const maxYaw = toFiniteNumber(c.maxYawDeg, d.maxYawDeg);
  return {
    emaAlpha: clamp(toFiniteNumber(c.emaAlpha, d.emaAlpha), 0.01, 1),
    deadzoneDeg: clamp(toFiniteNumber(c.deadzoneDeg, d.deadzoneDeg), 0, 10),
    invertX: c.invertX === true,
    invertY: c.invertY === true,
    invertYaw: c.invertYaw === true,
    maxTiltDeg: maxTilt > 0 ? maxTilt : d.maxTiltDeg,
    maxYawDeg: maxYaw > 0 ? maxYaw : d.maxYawDeg,
  };
}

/**
 * Mittelt mehrere Board-Winkel. Yaw wird zirkulär gemittelt (359° und 1° → 0°, nicht 180°).
 * @param {Array<{rollDeg: number, pitchDeg: number, yawDeg: number}>} samples
 * @returns {{rollDeg: number, pitchDeg: number, yawDeg: number} | null}
 */
export function averageBoardAngles(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const reference = toFiniteNumber(samples[samples.length - 1].yawDeg);
  let roll = 0;
  let pitch = 0;
  let yawOffset = 0;
  for (const sample of samples) {
    roll += toFiniteNumber(sample.rollDeg);
    pitch += toFiniteNumber(sample.pitchDeg);
    yawOffset += shortestAngleDelta(sample.yawDeg, reference);
  }
  const n = samples.length;
  return {
    rollDeg: roll / n + 0,
    pitchDeg: pitch / n + 0,
    yawDeg: normalizeAngle360(reference + yawOffset / n),
  };
}

/**
 * Erzeugt einen zustandsbehafteten (aber DOM-freien) Tilt-Prozessor.
 *
 * Pipeline pro Messwert:
 *   absolute Board-Winkel → minus Nullpunkt (Yaw wrap-around-sicher) → Achsen-Invertierung
 *   → EMA-Filter → Deadzone → Normierung & Clamping auf [-1, +1]
 *
 * Die Invertierung wird erst nach dem Nullpunkt angewendet, damit ein Umschalten von
 * invertX/invertY/invertYaw eine bestehende Kalibrierung nicht verfälscht.
 * Der Yaw-Nullpunkt wird beim ersten Messwert automatisch gesetzt, weil der absolute
 * alpha-Wert vieler Geräte keinen festen Bezug hat.
 *
 * @param {{calibrationWindow?: number}} [options]
 */
export function createTiltProcessor(options = {}) {
  const windowSize = Math.max(1, Math.floor(toFiniteNumber(options.calibrationWindow, DEFAULT_CALIBRATION_WINDOW)));
  let zero = { rollDeg: 0, pitchDeg: 0, yawDeg: 0 };
  let yawZeroSet = false;
  /** @type {{roll: number, pitch: number, yaw: number} | null} */
  let filtered = null;
  /** @type {Array<{rollDeg: number, pitchDeg: number, yawDeg: number}>} */
  let recent = [];
  let lastState = ZERO_TILT_STATE;

  /**
   * Verarbeitet absolute Board-Winkel zu einem TiltState.
   * @param {{rollDeg: number, pitchDeg: number, yawDeg: number}} angles
   * @param {Partial<typeof DEFAULT_PROCESSING_CONFIG>} [config]
   */
  function process(angles, config) {
    const cfg = sanitizeProcessingConfig(config);
    const abs = {
      rollDeg: toFiniteNumber(angles?.rollDeg),
      pitchDeg: toFiniteNumber(angles?.pitchDeg),
      yawDeg: normalizeAngle360(toFiniteNumber(angles?.yawDeg)),
    };

    recent.push(abs);
    if (recent.length > windowSize) recent.shift();

    if (!yawZeroSet) {
      zero = { ...zero, yawDeg: abs.yawDeg };
      yawZeroSet = true;
    }

    let relRoll = abs.rollDeg - zero.rollDeg;
    let relPitch = abs.pitchDeg - zero.pitchDeg;
    let relYaw = shortestAngleDelta(abs.yawDeg, zero.yawDeg);
    if (cfg.invertX) relRoll = -relRoll;
    if (cfg.invertY) relPitch = -relPitch;
    if (cfg.invertYaw) relYaw = -relYaw;

    if (filtered === null) {
      filtered = { roll: relRoll, pitch: relPitch, yaw: relYaw };
    } else {
      filtered = {
        roll: applyEma(filtered.roll, relRoll, cfg.emaAlpha),
        pitch: applyEma(filtered.pitch, relPitch, cfg.emaAlpha),
        yaw: applyEma(filtered.yaw, relYaw, cfg.emaAlpha),
      };
    }

    const roll = applyDeadzone(filtered.roll, cfg.deadzoneDeg);
    const pitch = applyDeadzone(filtered.pitch, cfg.deadzoneDeg);
    const yaw = applyDeadzone(filtered.yaw, cfg.deadzoneDeg);

    lastState = Object.freeze({
      x: normalizeAxis(roll, cfg.maxTiltDeg),
      y: normalizeAxis(pitch, cfg.maxTiltDeg),
      yaw: normalizeAxis(yaw, cfg.maxYawDeg),
      rawRoll: roll,
      rawPitch: pitch,
      rawYaw: yaw,
      absRoll: abs.rollDeg,
      absPitch: abs.pitchDeg,
      absYaw: abs.yawDeg,
    });
    return lastState;
  }

  /**
   * Komfortfunktion: Rohwerte des DeviceOrientation-Events direkt verarbeiten.
   * @param {{alpha?: number|null, beta?: number|null, gamma?: number|null}} orientation
   * @param {number} screenAngle
   * @param {Partial<typeof DEFAULT_PROCESSING_CONFIG>} [config]
   */
  function processOrientation(orientation, screenAngle, config) {
    return process(mapOrientationToBoard(orientation, screenAngle), config);
  }

  /**
   * Setzt den Nullpunkt auf den Mittelwert der letzten Messwerte (calibrateZero()).
   * @returns {{rollDeg: number, pitchDeg: number, yawDeg: number} | null} null, wenn noch keine Messwerte vorliegen
   */
  function calibrateZero() {
    const average = averageBoardAngles(recent);
    if (!average) return null;
    zero = average;
    yawZeroSet = true;
    filtered = { roll: 0, pitch: 0, yaw: 0 };
    return { ...zero };
  }

  /**
   * Übernimmt einen gespeicherten Nullpunkt (fehlende/ungültige Felder bleiben unverändert).
   * @param {{rollDeg?: number, pitchDeg?: number, yawDeg?: number}} partial
   */
  function setZero(partial) {
    const next = { ...zero };
    if (Number.isFinite(partial?.rollDeg)) next.rollDeg = partial.rollDeg;
    if (Number.isFinite(partial?.pitchDeg)) next.pitchDeg = partial.pitchDeg;
    if (Number.isFinite(partial?.yawDeg)) {
      next.yawDeg = normalizeAngle360(partial.yawDeg);
      yawZeroSet = true;
    }
    zero = next;
    filtered = null;
  }

  function getZero() {
    return { ...zero };
  }

  function resetFilter() {
    filtered = null;
  }

  function reset() {
    zero = { rollDeg: 0, pitchDeg: 0, yawDeg: 0 };
    yawZeroSet = false;
    filtered = null;
    recent = [];
    lastState = ZERO_TILT_STATE;
  }

  return {
    process,
    processOrientation,
    calibrateZero,
    setZero,
    getZero,
    resetFilter,
    reset,
    getLastState: () => lastState,
    hasSamples: () => recent.length > 0,
  };
}
