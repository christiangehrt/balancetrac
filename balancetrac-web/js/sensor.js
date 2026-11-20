/**
 * sensor.js – Browser-Sensor-Anbindung für BalanceTrac.
 *
 * - DeviceOrientation-Listener mit Landscape-Korrektur (screen.orientation.angle)
 * - iOS-Freigabe (DeviceOrientationEvent.requestPermission) ausschließlich aus einer Benutzer-Geste
 * - Secure-Context- und "keine Daten"-Erkennung für den HTTPS-/Simulator-Hinweis
 * - Umschaltbare Datenquelle: Gerätesensor oder Sensor-Simulator (getrennte Nullpunkte)
 *
 * Die eigentliche Mathematik liegt DOM-frei in sensorMath.js.
 */

import { createTiltProcessor, mapOrientationToBoard, normalizeScreenAngle, ZERO_TILT_STATE } from './sensorMath.js';

export const SENSOR_STATUS = Object.freeze({
  IDLE: 'idle',
  NEEDS_PERMISSION: 'needsPermission',
  WAITING: 'waiting',
  ACTIVE: 'active',
  DENIED: 'denied',
  UNSUPPORTED: 'unsupported',
  INSECURE: 'insecure',
  NO_DATA: 'noData',
});

export const SENSOR_SOURCE = Object.freeze({
  DEVICE: 'device',
  SIMULATOR: 'simulator',
});

/** Nach dieser Zeit ohne Messwert gilt der Gerätesensor als "keine Daten". */
export const NO_DATA_TIMEOUT_MS = 2500;

/**
 * Aktueller Bildschirm-Orientierungswinkel (0, 90, 180, 270).
 * Fallback auf das veraltete window.orientation (ältere iOS-Versionen) bzw. 0.
 * @returns {0|90|180|270}
 */
export function readScreenAngle() {
  const orientation = globalThis.screen?.orientation;
  if (orientation && typeof orientation.angle === 'number') return normalizeScreenAngle(orientation.angle);
  if (typeof globalThis.orientation === 'number') return normalizeScreenAngle(globalThis.orientation);
  return 0;
}

/** @returns {boolean} true, wenn der Browser eine explizite Freigabe verlangt (iOS 13+) */
export function sensorNeedsPermission() {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
}

/** @returns {boolean} true, wenn die DeviceOrientation API existiert */
export function sensorApiAvailable() {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
}

function isSecure() {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

export class SensorService {
  #getConfig;
  #onDeviceCalibrated;
  #device = createTiltProcessor();
  #simulator = createTiltProcessor();
  #source = SENSOR_SOURCE.DEVICE;
  #status = SENSOR_STATUS.IDLE;
  #tilt = ZERO_TILT_STATE;
  /** @type {{alpha: number, beta: number, gamma: number, screenAngle: number, absolute: boolean} | null} */
  #raw = null;
  #listening = false;
  #permissionGranted = false;
  #noDataTimer = 0;
  #tiltListeners = new Set();
  #statusListeners = new Set();
  /** Gebundener Event-Handler (private Methoden selbst sind nicht überschreibbar). */
  #onOrientation = (event) => this.#handleOrientation(event);

  /**
   * @param {{
   *   getConfig: () => import('./sensorMath.js').DEFAULT_PROCESSING_CONFIG,
   *   onDeviceCalibrated?: (zero: {rollDeg: number, pitchDeg: number, yawDeg: number}) => void,
   * }} options
   */
  constructor({ getConfig, onDeviceCalibrated } = {}) {
    if (typeof getConfig !== 'function') throw new TypeError('SensorService: getConfig ist erforderlich');
    this.#getConfig = getConfig;
    this.#onDeviceCalibrated = typeof onDeviceCalibrated === 'function' ? onDeviceCalibrated : null;
  }

  /**
   * Startet – wo ohne Freigabe möglich – sofort das Lauschen auf Sensordaten,
   * damit fehlende Sensoren früh erkannt werden.
   */
  init() {
    if (!sensorApiAvailable()) {
      this.#setStatus(SENSOR_STATUS.UNSUPPORTED);
      return;
    }
    if (sensorNeedsPermission()) {
      this.#setStatus(isSecure() ? SENSOR_STATUS.NEEDS_PERMISSION : SENSOR_STATUS.INSECURE);
      return;
    }
    this.#startListening();
  }

  /**
   * Fordert (falls nötig) die Sensor-Freigabe an und startet das Lauschen.
   * MUSS synchron aus einem Klick-/Touch-Handler aufgerufen werden: requestPermission()
   * wird vor jedem await gestartet, damit iOS die Benutzer-Geste erkennt.
   * @returns {Promise<string>} resultierender Status
   */
  requestAccess() {
    if (!sensorApiAvailable()) {
      this.#setStatus(SENSOR_STATUS.UNSUPPORTED);
      return Promise.resolve(this.#status);
    }
    if (sensorNeedsPermission() && !this.#permissionGranted) {
      let request;
      try {
        request = window.DeviceOrientationEvent.requestPermission();
      } catch {
        this.#setStatus(isSecure() ? SENSOR_STATUS.DENIED : SENSOR_STATUS.INSECURE);
        return Promise.resolve(this.#status);
      }
      return Promise.resolve(request).then(
        (result) => {
          if (result === 'granted') {
            this.#permissionGranted = true;
            this.#startListening();
          } else {
            this.#setStatus(SENSOR_STATUS.DENIED);
          }
          return this.#status;
        },
        () => {
          this.#setStatus(isSecure() ? SENSOR_STATUS.DENIED : SENSOR_STATUS.INSECURE);
          return this.#status;
        },
      );
    }
    this.#startListening();
    return Promise.resolve(this.#status);
  }

  /**
   * Schaltet zwischen Gerätesensor und Simulator um. Beide Quellen haben eigene Nullpunkte.
   * @param {'device'|'simulator'} source
   */
  setSource(source) {
    const next = source === SENSOR_SOURCE.SIMULATOR ? SENSOR_SOURCE.SIMULATOR : SENSOR_SOURCE.DEVICE;
    if (next === this.#source) return;
    this.#source = next;
    this.#tilt = (next === SENSOR_SOURCE.SIMULATOR ? this.#simulator : this.#device).getLastState();
    this.#emitTilt();
    this.#emitStatus();
  }

  /**
   * Nimmt absolute Board-Winkel aus dem Simulator entgegen (nur wirksam, wenn Quelle = Simulator).
   * @param {{rollDeg: number, pitchDeg: number, yawDeg: number}} angles
   */
  ingestSimulated(angles) {
    if (this.#source !== SENSOR_SOURCE.SIMULATOR) return;
    this.#tilt = this.#simulator.process(angles, this.#getConfig());
    this.#emitTilt();
  }

  /**
   * Setzt den Nullpunkt der aktiven Quelle (zeroRoll, zeroPitch, zeroYaw).
   * @returns {{rollDeg: number, pitchDeg: number, yawDeg: number} | null}
   */
  calibrateZero() {
    if (this.#source === SENSOR_SOURCE.SIMULATOR) {
      return this.#simulator.calibrateZero();
    }
    const zero = this.#device.calibrateZero();
    if (!zero) return null;
    if (this.#raw) {
      this.#tilt = this.#device.process(mapOrientationToBoard(this.#raw, this.#raw.screenAngle), this.#getConfig());
      this.#emitTilt();
    }
    if (this.#onDeviceCalibrated) this.#onDeviceCalibrated(zero);
    return zero;
  }

  /**
   * Übernimmt einen gespeicherten Roll/Pitch-Nullpunkt des Gerätesensors.
   * (Der Yaw-Nullpunkt wird nicht gespeichert, da alpha je nach Gerät keinen festen Bezug hat.)
   * @param {{zeroRoll: number, zeroPitch: number} | null} calibration
   */
  restoreDeviceZero(calibration) {
    if (!calibration) return;
    this.#device.setZero({ rollDeg: calibration.zeroRoll, pitchDeg: calibration.zeroPitch });
  }

  /**
   * Setzt den Roll/Pitch-Nullpunkt der aktiven Quelle auf 0° zurück (Yaw bleibt relativ).
   */
  resetZero() {
    const processor = this.#source === SENSOR_SOURCE.SIMULATOR ? this.#simulator : this.#device;
    processor.setZero({ rollDeg: 0, pitchDeg: 0 });
    if (this.#source === SENSOR_SOURCE.DEVICE && this.#raw) {
      this.#tilt = this.#device.process(mapOrientationToBoard(this.#raw, this.#raw.screenAngle), this.#getConfig());
      this.#emitTilt();
    }
  }

  /** @returns {{rollDeg: number, pitchDeg: number, yawDeg: number}} Nullpunkt der aktiven Quelle */
  getZero() {
    return (this.#source === SENSOR_SOURCE.SIMULATOR ? this.#simulator : this.#device).getZero();
  }

  /** @returns {Readonly<typeof ZERO_TILT_STATE>} aktueller normierter TiltState */
  getTilt() {
    return this.#tilt;
  }

  /** @returns {{alpha: number, beta: number, gamma: number, screenAngle: number, absolute: boolean} | null} */
  getRaw() {
    return this.#raw;
  }

  /** @returns {string} Status des Gerätesensors (SENSOR_STATUS) */
  getStatus() {
    return this.#status;
  }

  /** @returns {'device'|'simulator'} */
  getSource() {
    return this.#source;
  }

  /** @returns {boolean} true, wenn die aktive Quelle Daten liefert */
  isDelivering() {
    if (this.#source === SENSOR_SOURCE.SIMULATOR) return this.#simulator.hasSamples();
    return this.#status === SENSOR_STATUS.ACTIVE;
  }

  /**
   * @param {(tilt: Readonly<typeof ZERO_TILT_STATE>) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#tiltListeners.add(listener);
    return () => this.#tiltListeners.delete(listener);
  }

  /**
   * @param {(status: string, source: string) => void} listener
   * @returns {() => void}
   */
  onStatusChange(listener) {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  destroy() {
    if (this.#listening) window.removeEventListener('deviceorientation', this.#onOrientation);
    this.#listening = false;
    clearTimeout(this.#noDataTimer);
    this.#tiltListeners.clear();
    this.#statusListeners.clear();
  }

  #startListening() {
    if (this.#listening) {
      if (this.#status === SENSOR_STATUS.NO_DATA) this.#armNoDataTimer();
      return;
    }
    window.addEventListener('deviceorientation', this.#onOrientation);
    this.#listening = true;
    this.#setStatus(isSecure() ? SENSOR_STATUS.WAITING : SENSOR_STATUS.INSECURE);
    this.#armNoDataTimer();
  }

  #armNoDataTimer() {
    clearTimeout(this.#noDataTimer);
    this.#noDataTimer = setTimeout(() => {
      if (this.#status !== SENSOR_STATUS.ACTIVE) {
        this.#setStatus(isSecure() ? SENSOR_STATUS.NO_DATA : SENSOR_STATUS.INSECURE);
      }
    }, NO_DATA_TIMEOUT_MS);
  }

  /** @param {DeviceOrientationEvent} event */
  #handleOrientation(event) {
    // Manche Desktop-Browser feuern ein einzelnes Event ohne Werte – das zählt nicht als Sensor.
    if (event.beta === null && event.gamma === null) return;
    if (event.beta === undefined && event.gamma === undefined) return;

    const screenAngle = readScreenAngle();
    this.#raw = {
      alpha: typeof event.alpha === 'number' ? event.alpha : 0,
      beta: typeof event.beta === 'number' ? event.beta : 0,
      gamma: typeof event.gamma === 'number' ? event.gamma : 0,
      screenAngle,
      absolute: event.absolute === true,
    };

    if (this.#status !== SENSOR_STATUS.ACTIVE) {
      clearTimeout(this.#noDataTimer);
      this.#setStatus(SENSOR_STATUS.ACTIVE);
    }

    if (this.#source === SENSOR_SOURCE.DEVICE) {
      this.#tilt = this.#device.process(mapOrientationToBoard(this.#raw, screenAngle), this.#getConfig());
      this.#emitTilt();
    }
  }

  #setStatus(status) {
    if (status === this.#status) return;
    this.#status = status;
    this.#emitStatus();
  }

  #emitStatus() {
    for (const listener of this.#statusListeners) listener(this.#status, this.#source);
  }

  #emitTilt() {
    for (const listener of this.#tiltListeners) listener(this.#tilt);
  }
}
