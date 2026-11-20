/**
 * main.js – App-Bootstrap für BalanceTrac
 *  - Settings & Sprache, Sensor-Service, Hash-Router
 *  - Screen Wake Lock (automatische Re-Aktivierung bei visibilitychange)
 *  - Vollbild-Toggle + screen.orientation.lock('landscape')
 *  - Sensor-/HTTPS-Hinweis mit Simulator-Schnellstart, Querformat-Hinweis
 *  - AudioContext-Freischaltung in der Go!-Geste, Service-Worker-Registrierung
 */

import { createAudioEngine } from './audio.js';
import { APP_VERSION, createSettingsStore, getLevelConfig } from './config.js';
import { detectLanguage, getLanguage, onLanguageChange, setLanguage, SUPPORTED_LANGUAGES, t } from './i18n.js';
import { rotateDeviceIllustration, uiIcon } from './icons.js';
import { SENSOR_SOURCE, SENSOR_STATUS, SensorService } from './sensor.js';
import { createSessionRepository } from './storage.js';
import { createDiagnosticsView } from './views/diagnosticsView.js';
import { createHistoryView } from './views/historyView.js';
import { createHomeView } from './views/homeView.js';
import { createMeasureView } from './views/measureView.js';
import { createPlayView } from './views/playView.js';
import { createSettingsView } from './views/settingsView.js';
import { createSimulatorOverlay } from './views/simulatorOverlay.js';
import { createTrainView } from './views/trainView.js';
import { createSegmented, h, iconButton, isEditableTarget, openDrawer, showToast } from './views/ui.js';

const ROUTES = Object.freeze({
  home: createHomeView,
  diagnostics: createDiagnosticsView,
  measure: createMeasureView,
  train: createTrainView,
  play: createPlayView,
  history: createHistoryView,
  settings: createSettingsView,
});

/** Ziel-Ansicht für "Go!" je Modus. */
const MODE_ROUTES = Object.freeze({
  MEASURE: 'measure',
  TRAIN: 'train',
  PLAY: 'play',
});

const BANNER_STATUSES = new Set([
  SENSOR_STATUS.NEEDS_PERMISSION,
  SENSOR_STATUS.DENIED,
  SENSOR_STATUS.UNSUPPORTED,
  SENSOR_STATUS.INSECURE,
  SENSOR_STATUS.NO_DATA,
]);

// ---- Settings, Umgebung & Sprache ---------------------------------------------------------

const settings = createSettingsStore();
const env = detectEnvironment();

setLanguage(settings.get().language ?? detectLanguage(readNavigatorLanguages()));
applyDocumentLanguage();
document.body.classList.toggle('is-touch', env.isTouch);

function detectEnvironment() {
  const matches = (query) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return Object.freeze({
    isTouch: matches('(pointer: coarse)'),
    isDesktopLike: matches('(hover: hover) and (pointer: fine)'),
    isStandalone: matches('(display-mode: fullscreen)') || matches('(display-mode: standalone)') || navigator.standalone === true,
    prefersReducedMotion: matches('(prefers-reduced-motion: reduce)'),
  });
}

function readNavigatorLanguages() {
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages;
  return [navigator.language];
}

function applyDocumentLanguage() {
  document.documentElement.lang = getLanguage();
  document.title = t('app.name');
}

function currentLevelConfig() {
  const s = settings.get();
  return getLevelConfig(s.lastLevel, s);
}

// ---- Sensor ------------------------------------------------------------------------------

const processingCache = { source: null, config: null };

function getProcessingConfig() {
  const s = settings.get();
  if (processingCache.source !== s) {
    const levelConfig = getLevelConfig(s.lastLevel, s);
    processingCache.source = s;
    processingCache.config = Object.freeze({
      emaAlpha: s.emaAlpha,
      deadzoneDeg: s.deadzoneDeg,
      invertX: s.invertX,
      invertY: s.invertY,
      invertYaw: s.invertYaw,
      maxTiltDeg: levelConfig.maxTiltDeg,
      maxYawDeg: levelConfig.maxYawDeg,
    });
  }
  return processingCache.config;
}

const sensor = new SensorService({
  getConfig: getProcessingConfig,
  onDeviceCalibrated: (zero) =>
    settings.update({
      calibration: { zeroRoll: zero.rollDeg, zeroPitch: zero.pitchDeg, timestampMillis: Date.now() },
    }),
});
sensor.restoreDeviceZero(settings.get().calibration);

// ---- Wake Lock ---------------------------------------------------------------------------

function createWakeLockController() {
  const supported = 'wakeLock' in navigator;
  let sentinel = null;
  let pending = null;
  let wanted = false;
  const listeners = new Set();

  const getState = () => (!supported ? 'unsupported' : sentinel ? 'active' : 'inactive');
  const notify = () => {
    for (const listener of listeners) listener(getState());
  };

  function request() {
    wanted = true;
    if (!supported || sentinel || document.visibilityState !== 'visible') return Promise.resolve(getState());
    if (pending) return pending;
    pending = navigator.wakeLock
      .request('screen')
      .then((lock) => {
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
          notify();
        });
      })
      .catch(() => {
        sentinel = null;
      })
      .then(() => {
        pending = null;
        notify();
        return getState();
      });
    return pending;
  }

  // Der Browser gibt den Wake Lock beim Wechsel in den Hintergrund frei → bei Rückkehr neu anfordern.
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible' && !sentinel) request();
  });

  return {
    request,
    getState,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const wakeLock = createWakeLockController();

// ---- Audio & Session-Speicher ------------------------------------------------------------

const audio = createAudioEngine({
  isSoundEnabled: () => settings.get().soundEnabled,
  isVoiceEnabled: () => settings.get().voiceEnabled,
  getLanguage,
});

const sessions = createSessionRepository();

// ---- Vollbild & Querformat ---------------------------------------------------------------

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

async function lockLandscape() {
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      await screen.orientation.lock('landscape');
    }
  } catch {
    // Nicht unterstützt (Desktop, iOS) oder nur im Vollbild erlaubt – der Querformat-Hinweis übernimmt.
  }
}

async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    const root = document.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else {
      showToast(t('toast.fullscreenUnsupported'), 4000);
      return;
    }
    await lockLandscape();
  } catch {
    showToast(t('toast.fullscreenUnsupported'), 4000);
  }
}

function syncFullscreenClass() {
  document.body.classList.toggle('is-fullscreen', isFullscreen());
}
document.addEventListener('fullscreenchange', syncFullscreenClass);
document.addEventListener('webkitfullscreenchange', syncFullscreenClass);

// ---- Aktionen ----------------------------------------------------------------------------

function handleAccessResult(status) {
  // Im Simulator-Betrieb ist eine verweigerte Gerätefreigabe ohne Belang – kein Hinweis.
  if (status === SENSOR_STATUS.DENIED && !settings.get().simulatorEnabled) {
    showToast(t('toast.permissionDenied'), 3500);
  }
}

const actions = {
  /**
   * Muss synchron aus einer Benutzer-Geste aufgerufen werden: Sensor-Freigabe (iOS),
   * AudioContext und Wake Lock.
   */
  prepareSession() {
    const access = sensor.requestAccess();
    audio.unlock();
    wakeLock.request();
    access.then(handleAccessResult);
  },
  /** Go!: Session vorbereiten und das Modul des gewählten Modus öffnen. */
  go() {
    actions.prepareSession();
    router.navigate(MODE_ROUTES[settings.get().lastMode] ?? 'diagnostics');
  },
  requestSensors() {
    const access = sensor.requestAccess();
    audio.unlock();
    access.then(handleAccessResult);
  },
  toggleSound() {
    const enabled = !settings.get().soundEnabled;
    settings.update({ soundEnabled: enabled });
    if (enabled) {
      audio.unlock();
      audio.play('tick');
    }
    showToast(t(enabled ? 'toast.soundOn' : 'toast.soundOff'));
  },
  calibrate() {
    if (!sensor.isDelivering()) {
      const access = sensor.requestAccess();
      access.then(handleAccessResult);
      showToast(t('toast.noData'), 3000);
      return;
    }
    const zero = sensor.calibrateZero();
    showToast(zero ? t('toast.calibrated') : t('toast.noData'));
  },
  resetCalibration() {
    sensor.resetZero();
    if (sensor.getSource() === SENSOR_SOURCE.DEVICE) settings.update({ calibration: null });
    showToast(t('toast.calibrationReset'));
  },
  toggleFullscreen,
  setSimulator(enabled) {
    if (settings.get().simulatorEnabled === enabled) return;
    settings.update({ simulatorEnabled: enabled });
    showToast(t(enabled ? 'toast.simulatorOn' : 'toast.simulatorOff'));
  },
  setLanguage(language) {
    settings.update({ language });
  },
  openMenu: () => openMainMenu(),
  navigate: (routeId, arg) => router.navigate(routeId, arg),
  goBack: () => router.back(),
};

// ---- Router ------------------------------------------------------------------------------

const viewContext = Object.freeze({
  t,
  settings,
  sensor,
  wakeLock,
  env,
  actions,
  audio,
  sessions,
  getLevelConfig: currentLevelConfig,
});

/**
 * Hash-Router: "#/<ansicht>" oder "#/<ansicht>/<argument>" (z. B. "#/settings/backup").
 * Views werden als routes[id](ctx, { arg }) erzeugt und beim Wechsel mit destroy() geschlossen.
 */
function createRouter(rootEl, routes, ctx) {
  let currentId = null;
  let currentArg = null;
  let currentView = null;
  let pushedInternally = false;

  const isRoute = (id) => Object.prototype.hasOwnProperty.call(routes, id);

  const parse = () => {
    const [id = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
    return isRoute(id) ? { id, arg: arg ? decodeURIComponent(arg) : null } : { id: 'home', arg: null };
  };

  function render({ id, arg }) {
    if (currentView) {
      try {
        currentView.destroy();
      } catch (error) {
        console.error('[BalanceTrac] Fehler beim Schließen der Ansicht:', error);
      }
    }
    rootEl.replaceChildren();
    currentId = id;
    currentArg = arg;
    currentView = routes[id](ctx, { arg });
    rootEl.append(currentView.el);
    document.body.dataset.view = id;
    // Optionaler Hook: Ansicht liegt jetzt im DOM (z. B. für die erste Canvas-Vermessung)
    if (typeof currentView.mounted === 'function') currentView.mounted();
  }

  window.addEventListener('hashchange', () => render(parse()));

  return {
    start() {
      render(parse());
    },
    navigate(id, arg = null) {
      const target = isRoute(id) ? id : 'home';
      if (target === currentId && (arg ?? null) === currentArg) return;
      pushedInternally = true;
      location.hash = `#/${target}${arg ? `/${encodeURIComponent(arg)}` : ''}`;
    },
    back() {
      if (currentId === 'home') return;
      if (pushedInternally) {
        pushedInternally = false;
        history.back();
      } else {
        history.replaceState(null, '', '#/home');
        render({ id: 'home', arg: null });
      }
    },
    refresh() {
      if (currentId) render({ id: currentId, arg: currentArg });
    },
    get current() {
      return currentId;
    },
  };
}

const router = createRouter(document.getElementById('view-root'), ROUTES, viewContext);

// ---- Seitenmenü --------------------------------------------------------------------------

function openMainMenu() {
  const simulatorOn = settings.get().simulatorEnabled;
  const soundOn = settings.get().soundEnabled;
  let close = () => {};
  const languageSegment = createSegmented({
    label: t('menu.language'),
    className: 'segmented-compact',
    options: SUPPORTED_LANGUAGES.map((language) => ({ value: language, label: t(`lang.${language}`) })),
    value: getLanguage(),
    onChange: (language) => {
      close();
      actions.setLanguage(language);
    },
  });
  close = openDrawer({
    title: t('menu.title'),
    closeLabel: t('common.close'),
    items: [
      { icon: 'home', label: t('menu.home'), onClick: () => router.navigate('home') },
      { icon: 'grid', label: t('menu.measure'), onClick: () => router.navigate('measure') },
      { icon: 'timer', label: t('menu.train'), onClick: () => router.navigate('train') },
      { icon: 'play', label: t('menu.play'), onClick: () => router.navigate('play') },
      { icon: 'chart', label: t('menu.history'), onClick: () => router.navigate('history') },
      { icon: 'calibrate', label: t('menu.calibrate'), onClick: () => actions.calibrate() },
      { icon: 'settings', label: t('menu.settings'), onClick: () => router.navigate('settings') },
      { icon: 'backup', label: t('menu.backup'), onClick: () => router.navigate('settings', 'backup') },
      { icon: 'sensor', label: t('menu.diagnostics'), onClick: () => router.navigate('diagnostics') },
      {
        icon: soundOn ? 'sound' : 'soundOff',
        label: soundOn ? t('menu.soundOff') : t('menu.soundOn'),
        onClick: () => actions.toggleSound(),
      },
      {
        icon: 'joystick',
        label: simulatorOn ? t('menu.simulatorOff') : t('menu.simulatorOn'),
        onClick: () => actions.setSimulator(!simulatorOn),
      },
    ],
    footer: [languageSegment.el, h('p', { class: 'drawer-version', text: t('menu.version', { version: APP_VERSION }) })],
  });
}

// ---- Simulator ---------------------------------------------------------------------------

let simulatorOverlay = null;

function mountSimulator() {
  simulatorOverlay = createSimulatorOverlay({
    t,
    sensor,
    getLevelConfig: currentLevelConfig,
    onCalibrate: () => actions.calibrate(),
    onClose: () => actions.setSimulator(false),
  });
  document.body.append(simulatorOverlay.el);
}

function syncSimulator() {
  const enabled = settings.get().simulatorEnabled;
  document.body.classList.toggle('sim-active', enabled);
  sensor.setSource(enabled ? SENSOR_SOURCE.SIMULATOR : SENSOR_SOURCE.DEVICE);
  if (enabled && !simulatorOverlay) mountSimulator();
  if (!enabled && simulatorOverlay) {
    simulatorOverlay.destroy();
    simulatorOverlay = null;
  }
}

// ---- Sensor-/HTTPS-Hinweis ---------------------------------------------------------------

const bannerEl = document.getElementById('sensor-banner');
/** Einmal weggeklickt, bleibt der Hinweis für diese Sitzung ausgeblendet (Fehler melden dann Toasts). */
let bannerDismissed = false;

function updateBanner() {
  const status = sensor.getStatus();
  const visible = !settings.get().simulatorEnabled && BANNER_STATUSES.has(status) && !bannerDismissed;
  if (!visible) {
    bannerEl.hidden = true;
    bannerEl.replaceChildren();
    syncBannerSpace();
    return;
  }
  const canRequest = status === SENSOR_STATUS.NEEDS_PERMISSION || status === SENSOR_STATUS.DENIED;
  bannerEl.replaceChildren(
    h('span', { class: 'sensor-banner-icon', html: uiIcon('sensor') }),
    h('p', { class: 'sensor-banner-text', text: t(`banner.${status}`) }),
    canRequest
      ? h('button', { type: 'button', class: 'btn', on: { click: () => actions.requestSensors() } }, t('banner.activate'))
      : null,
    h(
      'button',
      { type: 'button', class: 'btn btn-primary', on: { click: () => actions.setSimulator(true) } },
      t('banner.useSimulator'),
    ),
    iconButton({
      icon: 'close',
      label: t('banner.dismiss'),
      onClick: () => {
        bannerDismissed = true;
        updateBanner();
      },
    }),
  );
  bannerEl.hidden = false;
  syncBannerSpace();
}

/** Reserviert unten Platz für den Hinweis, damit er keine Bedienelemente verdeckt. */
function syncBannerSpace() {
  const visible = !bannerEl.hidden;
  document.body.classList.toggle('has-banner', visible);
  const space = visible ? Math.ceil(bannerEl.getBoundingClientRect().height) + 20 : 0;
  document.documentElement.style.setProperty('--banner-space', `${space}px`);
}
window.addEventListener('resize', () => syncBannerSpace());

// ---- Querformat-Hinweis ------------------------------------------------------------------

const rotateEl = document.getElementById('rotate-hint');

function renderRotateHint() {
  rotateEl.replaceChildren(
    h('div', { html: rotateDeviceIllustration() }),
    h('p', { class: 'rotate-title', text: t('rotate.title') }),
    h('p', { class: 'rotate-text', text: t('rotate.text') }),
  );
}

// ---- Service Worker ----------------------------------------------------------------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showToast(t('toast.appUpdated'), 3500);
  });
  navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.warn('[BalanceTrac] Service-Worker-Registrierung fehlgeschlagen:', error);
  });
}

// ---- Globale Listener --------------------------------------------------------------------

settings.subscribe((next, previous) => {
  if (next.language && next.language !== previous.language) setLanguage(next.language);
  if (next.simulatorEnabled !== previous.simulatorEnabled) {
    syncSimulator();
    updateBanner();
  }
});

onLanguageChange(() => {
  applyDocumentLanguage();
  renderRotateHint();
  updateBanner();
  if (simulatorOverlay) {
    simulatorOverlay.destroy();
    simulatorOverlay = null;
    mountSimulator();
  }
  router.refresh();
});

sensor.onStatusChange(() => updateBanner());

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isEditableTarget(event.target)) return;
  if (event.code === 'KeyC') {
    event.preventDefault();
    actions.calibrate();
  }
});

if (typeof window.matchMedia === 'function') {
  window.matchMedia('(pointer: coarse)').addEventListener('change', (event) => {
    document.body.classList.toggle('is-touch', event.matches);
  });
}

// ---- Start -------------------------------------------------------------------------------

renderRotateHint();
syncSimulator();
sensor.init();
router.start();
updateBanner();
syncFullscreenClass();
registerServiceWorker();
wakeLock.request();
if (env.isStandalone) lockLandscape();
