/**
 * settingsView.js – Einstellungen
 *  - Kalibrierung (Nullpunkt setzen/zurücksetzen, Live-Werte)
 *  - Achsen-Invertierung, Filter-Glättung (EMA) und Deadzone
 *  - Level-Empfindlichkeit (maxTiltDeg, maxYawDeg, targetSpeedMultiplier, toleranceRadius je Level)
 *  - Measure & Ton (Dauer, Aufsteig-Countdown, Soundeffekte, Sprachansagen)
 *  - Sprache DE/EN, Sensor-Simulator
 *  - Datensicherung: JSON-Export/-Import mit Schema-Validierung, Verlauf löschen
 */

import {
  APP_VERSION,
  BOARD_CONFIG,
  DEADZONE_LIMITS,
  EMA_ALPHA_LIMITS,
  getLevelConfig,
  LEVEL_OVERRIDE_LIMITS,
  LEVELS,
  MEASURE_DURATIONS,
  MOUNT_COUNTDOWN_LIMITS,
  SHOOTER_FIRE_MODES,
} from '../config.js';
import { getLanguage, SUPPORTED_LANGUAGES } from '../i18n.js';
import { downloadBackup, readBackupFile, validateBackup } from '../storage.js';
import { createSegmented, createToggle, createTopBar, formatDeg, formatNumber, h, openDialog, setText, showToast } from './ui.js';

const LIVE_UPDATE_MS = 120;

const LEVEL_FIELDS = Object.freeze([
  { key: 'maxTiltDeg', labelKey: 'settings.levels.maxTilt', step: 1, format: (v) => `${Math.round(v)}°` },
  { key: 'maxYawDeg', labelKey: 'settings.levels.maxYaw', step: 1, format: (v) => `${Math.round(v)}°` },
  { key: 'targetSpeedMultiplier', labelKey: 'settings.levels.speed', step: 0.05, format: (v) => `×${formatNumber(v, 2)}` },
  { key: 'toleranceRadius', labelKey: 'settings.levels.tolerance', step: 0.01, format: (v) => formatNumber(v, 2) },
]);

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @param {{arg?: string|null}} [route]  arg "backup" springt zur Datensicherung
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createSettingsView(ctx, route = {}) {
  const { t, settings, sensor, sessions, actions, audio } = ctx;
  const cleanups = [];
  const s0 = settings.get();

  const topBar = createTopBar({
    title: t('settings.title'),
    menuLabel: t('topbar.menu'),
    onMenu: () => actions.openMenu(),
    back: { label: t('common.goBack'), onClick: () => actions.goBack() },
  });

  // ---- Kalibrierung ---------------------------------------------------------------------
  const zeroValue = h('dd');
  const liveValue = h('dd');
  const sourceValue = h('dd');
  const calibrationSection = section(
    'calibration',
    t('settings.calibration.title'),
    h('p', { class: 'settings-text', text: t('settings.calibration.text') }),
    h(
      'dl',
      { class: 'info-list' },
      h('dt', { text: t('diag.source') }),
      sourceValue,
      h('dt', { text: t('settings.calibration.zero') }),
      zeroValue,
      h('dt', { text: t('settings.calibration.live') }),
      liveValue,
    ),
    h(
      'div',
      { class: 'btn-row' },
      button(t('settings.calibration.set'), () => actions.calibrate(), 'btn-primary'),
      button(t('settings.calibration.reset'), () => actions.resetCalibration()),
      button(t('settings.calibration.openTest'), () => actions.navigate('diagnostics')),
    ),
  );

  let lastLiveUpdate = 0;
  function updateCalibration(force = false) {
    const now = performance.now();
    if (!force && now - lastLiveUpdate < LIVE_UPDATE_MS) return;
    lastLiveUpdate = now;
    const tilt = sensor.getTilt();
    const zero = sensor.getZero();
    setText(sourceValue, t(`diag.source.${sensor.getSource()}`));
    setText(zeroValue, `${formatDeg(zero.rollDeg)} / ${formatDeg(zero.pitchDeg)}`);
    setText(liveValue, sensor.isDelivering() ? `${formatDeg(tilt.rawRoll)} / ${formatDeg(tilt.rawPitch)}` : t(`diag.status.${sensor.getStatus()}`));
  }
  cleanups.push(sensor.subscribe(() => updateCalibration()));
  cleanups.push(sensor.onStatusChange(() => updateCalibration(true)));

  // ---- Achsen ---------------------------------------------------------------------------
  const invertX = createToggle({ label: t('diag.invertX'), checked: s0.invertX, onChange: (on) => settings.update({ invertX: on }) });
  const invertY = createToggle({ label: t('diag.invertY'), checked: s0.invertY, onChange: (on) => settings.update({ invertY: on }) });
  const invertYaw = createToggle({ label: t('diag.invertYaw'), checked: s0.invertYaw, onChange: (on) => settings.update({ invertYaw: on }) });
  const axesSection = section(
    'axes',
    t('settings.axes.title'),
    h('p', { class: 'settings-text', text: t('settings.axes.text') }),
    h('div', { class: 'toggle-grid' }, invertX.el, invertY.el, invertYaw.el),
  );

  // ---- Filter ---------------------------------------------------------------------------
  const emaRange = rangeField({
    label: t('diag.smoothing'),
    hint: t('settings.filter.emaHint'),
    min: EMA_ALPHA_LIMITS.min,
    max: EMA_ALPHA_LIMITS.max,
    step: 0.05,
    value: s0.emaAlpha,
    format: (v) => formatNumber(v, 2),
    onInput: (v) => settings.update({ emaAlpha: v }),
  });
  const deadzoneRange = rangeField({
    label: t('settings.filter.deadzone'),
    hint: t('settings.filter.deadzoneHint'),
    min: DEADZONE_LIMITS.min,
    max: DEADZONE_LIMITS.max,
    step: 0.1,
    value: s0.deadzoneDeg,
    format: (v) => `${formatNumber(v, 1)}°`,
    onInput: (v) => settings.update({ deadzoneDeg: v }),
  });
  const filterSection = section('filter', t('settings.filter.title'), emaRange.el, deadzoneRange.el);

  // ---- Level-Empfindlichkeit ------------------------------------------------------------
  let editLevel = s0.lastLevel;
  const levelFieldsEl = h('div', { class: 'level-fields' });
  const levelResetButton = button('', () => {
    const overrides = { ...settings.get().levelOverrides };
    delete overrides[String(editLevel)];
    settings.update({ levelOverrides: overrides });
    renderLevelFields();
  });
  const levelSegment = createSegmented({
    label: t('home.level'),
    className: 'segmented-compact',
    options: LEVELS.map((level) => ({ value: level, label: String(level) })),
    value: editLevel,
    onChange: (level) => {
      editLevel = level;
      renderLevelFields();
    },
  });
  const levelsSection = section(
    'levels',
    t('settings.levels.title'),
    h('p', { class: 'settings-text', text: t('settings.levels.text') }),
    levelSegment.el,
    levelFieldsEl,
    h('div', { class: 'btn-row' }, levelResetButton),
  );

  function renderLevelFields() {
    const s = settings.get();
    const effective = getLevelConfig(editLevel, s);
    const overrides = s.levelOverrides[String(editLevel)] ?? {};
    levelFieldsEl.replaceChildren(
      ...LEVEL_FIELDS.map((field) => {
        const limits = LEVEL_OVERRIDE_LIMITS[field.key];
        const custom = Object.prototype.hasOwnProperty.call(overrides, field.key) && overrides[field.key] !== BOARD_CONFIG[editLevel][field.key];
        return rangeField({
          label: t(field.labelKey),
          badge: custom ? t('settings.levels.custom') : null,
          min: limits.min,
          max: limits.max,
          step: field.step,
          value: effective[field.key],
          format: field.format,
          onInput: (value) => {
            const current = settings.get().levelOverrides;
            settings.update({
              levelOverrides: { ...current, [String(editLevel)]: { ...(current[String(editLevel)] ?? {}), [field.key]: value } },
            });
          },
          onCommit: () => renderLevelFields(),
        }).el;
      }),
    );
    levelResetButton.textContent = t('settings.levels.reset', { level: editLevel });
    levelResetButton.disabled = Object.keys(overrides).length === 0;
  }
  renderLevelFields();

  // ---- Measure & Ton --------------------------------------------------------------------
  const durationSegment = createSegmented({
    label: t('settings.measure.duration'),
    className: 'segmented-compact',
    options: MEASURE_DURATIONS.map((sec) => ({ value: sec, label: t('measure.durationValue', { sec }) })),
    value: s0.measureDurationSec,
    onChange: (sec) => settings.update({ measureDurationSec: sec }),
  });
  const countdownOptions = [];
  for (let sec = MOUNT_COUNTDOWN_LIMITS.min; sec <= MOUNT_COUNTDOWN_LIMITS.max; sec += 1) {
    countdownOptions.push({ value: sec, label: t('measure.durationValue', { sec }) });
  }
  const countdownSegment = createSegmented({
    label: t('settings.measure.countdown'),
    className: 'segmented-compact',
    options: countdownOptions,
    value: s0.mountCountdownSec,
    onChange: (sec) => settings.update({ mountCountdownSec: sec }),
  });
  const soundToggle = createToggle({
    label: t('settings.measure.sound'),
    checked: s0.soundEnabled,
    onChange: (on) => {
      settings.update({ soundEnabled: on });
      if (on) {
        audio.unlock();
        audio.play('tick');
      }
    },
  });
  const voiceToggle = createToggle({
    label: t('settings.measure.voice'),
    checked: s0.voiceEnabled,
    onChange: (on) => {
      settings.update({ voiceEnabled: on });
      voiceTestButton.disabled = !on;
    },
  });
  const voiceTestButton = button(t('settings.measure.voiceTest'), () => {
    audio.unlock();
    audio.speak(t('settings.measure.voiceSample'));
  });
  voiceTestButton.disabled = !s0.voiceEnabled;
  const measureSection = section(
    'measure',
    t('settings.measure.title'),
    labeledRow(t('settings.measure.duration'), durationSegment.el),
    labeledRow(t('settings.measure.countdown'), countdownSegment.el),
    h('div', { class: 'toggle-grid' }, soundToggle.el, voiceToggle.el),
    h('div', { class: 'btn-row' }, voiceTestButton),
  );

  // ---- Play -----------------------------------------------------------------------------
  const fireModeSegment = createSegmented({
    label: t('play.astro.fireMode'),
    className: 'segmented-compact',
    options: SHOOTER_FIRE_MODES.map((mode) => ({ value: mode, label: t(`play.astro.fireMode.${mode}`) })),
    value: s0.shooterFireMode,
    onChange: (mode) => settings.update({ shooterFireMode: mode }),
  });
  const playSection = section(
    'play',
    t('settings.play.title'),
    h('p', { class: 'settings-text', text: t('settings.play.text') }),
    labeledRow(t('play.astro.fireMode'), fireModeSegment.el),
  );

  // ---- Sprache & Simulator --------------------------------------------------------------
  const languageSegment = createSegmented({
    label: t('settings.language.title'),
    className: 'segmented-compact',
    options: SUPPORTED_LANGUAGES.map((language) => ({ value: language, label: t(`lang.${language}`) })),
    value: getLanguage(),
    onChange: (language) => actions.setLanguage(language),
  });
  const languageSection = section('language', t('settings.language.title'), languageSegment.el);

  const simulatorToggle = createToggle({
    label: t('settings.simulator.toggle'),
    checked: s0.simulatorEnabled,
    onChange: (on) => actions.setSimulator(on),
  });
  const simulatorSection = section(
    'simulator',
    t('settings.simulator.title'),
    h('p', { class: 'settings-text', text: t('settings.simulator.text') }),
    simulatorToggle.el,
  );

  // ---- Datensicherung -------------------------------------------------------------------
  const backupCount = h('p', { class: 'settings-text backup-count' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) importFile(file);
  });
  const clearButton = button(t('settings.backup.clear'), () => clearHistory(), 'btn-danger');
  const exportButton = button(t('settings.backup.export'), () => exportBackup(), 'btn-primary');
  const backupSection = section(
    'backup',
    t('settings.backup.title'),
    backupCount,
    h(
      'div',
      { class: 'btn-row' },
      exportButton,
      button(t('settings.backup.import'), () => fileInput.click()),
      clearButton,
    ),
    h('p', { class: 'settings-text settings-hint', text: t('settings.backup.hint') }),
    fileInput,
  );

  function sessionsLabel(count) {
    return count === 1 ? t('history.sessions.one') : t('history.sessions.other', { count });
  }

  function updateBackupInfo() {
    const count = sessions.getAll().length;
    setText(backupCount, t('settings.backup.count', { sessions: sessionsLabel(count) }));
    clearButton.disabled = count === 0;
    exportButton.disabled = count === 0;
  }
  cleanups.push(sessions.subscribe(updateBackupInfo));

  function exportBackup() {
    try {
      const fileName = downloadBackup(sessions);
      showToast(t('settings.backup.exported', { file: fileName }), 3500);
    } catch (error) {
      console.error('[BalanceTrac] Export fehlgeschlagen:', error);
      showToast(t('settings.backup.exportError'), 3500);
    }
  }

  async function importFile(file) {
    let data;
    try {
      data = await readBackupFile(file);
    } catch {
      showToast(t('settings.backup.readError'), 4000);
      return;
    }
    const check = validateBackup(data);
    if (!check.ok) {
      showToast(t(check.error === 'unsupportedVersion' ? 'settings.backup.unsupported' : 'settings.backup.invalid'), 4500);
      return;
    }
    const existing = sessions.getAll().length;
    const strategy = await openDialog({
      title: t('settings.backup.importTitle'),
      message: t('settings.backup.importText', {
        found: sessionsLabel(check.sessions.length),
        existing: sessionsLabel(existing),
      }),
      actions: [
        { label: t('settings.backup.merge'), value: 'merge', variant: 'primary' },
        { label: t('settings.backup.replace'), value: 'replace', variant: 'danger' },
        { label: t('common.cancel'), value: null },
      ],
    });
    if (!strategy) return;
    const result = sessions.importBackup(data, { strategy });
    if (!result.ok) {
      showToast(t(result.error === 'storageFull' ? 'settings.backup.storageFull' : 'settings.backup.invalid'), 4500);
      return;
    }
    showToast(
      t('settings.backup.imported', { added: result.added, duplicates: result.duplicates, skipped: result.skipped }),
      4500,
    );
  }

  async function clearHistory() {
    const count = sessions.getAll().length;
    if (count === 0) return;
    const confirmed = await openDialog({
      title: t('settings.backup.clearTitle'),
      message: t('settings.backup.clearText', { sessions: sessionsLabel(count) }),
      actions: [
        { label: t('common.cancel'), value: false },
        { label: t('settings.backup.clearConfirm'), value: true, variant: 'danger' },
      ],
      cancelValue: false,
    });
    if (!confirmed) return;
    if (sessions.clear()) showToast(t('settings.backup.cleared'));
    else showToast(t('settings.backup.storageFull'), 4000);
  }

  // ---- Über -----------------------------------------------------------------------------
  const aboutSection = section(
    'about',
    t('settings.about.title'),
    h('p', { class: 'settings-text', text: t('settings.about.text') }),
    h('p', { class: 'settings-text settings-hint', text: t('menu.version', { version: APP_VERSION }) }),
  );

  // ---- Zusammenbau & Synchronisation ----------------------------------------------------
  const main = h(
    'div',
    { class: 'settings-main' },
    h(
      'div',
      { class: 'settings-grid' },
      calibrationSection,
      axesSection,
      filterSection,
      levelsSection,
      measureSection,
      playSection,
      languageSection,
      simulatorSection,
      backupSection,
      aboutSection,
    ),
  );
  const el = h('section', { class: 'view view-settings' }, topBar, main);

  cleanups.push(
    settings.subscribe((next, previous) => {
      invertX.set(next.invertX);
      invertY.set(next.invertY);
      invertYaw.set(next.invertYaw);
      simulatorToggle.set(next.simulatorEnabled);
      soundToggle.set(next.soundEnabled);
      voiceToggle.set(next.voiceEnabled);
      if (next.measureDurationSec !== previous.measureDurationSec) durationSegment.set(next.measureDurationSec);
      if (next.shooterFireMode !== previous.shooterFireMode) fireModeSegment.set(next.shooterFireMode);
      if (next.simulatorEnabled !== previous.simulatorEnabled || next.calibration !== previous.calibration) {
        updateCalibration(true);
      }
      emaRange.sync(next.emaAlpha);
      deadzoneRange.sync(next.deadzoneDeg);
    }),
  );

  updateCalibration(true);
  updateBackupInfo();

  if (route.arg) {
    // Kurz warten, bis die Ansicht im DOM liegt und Layout hat
    setTimeout(() => {
      const target = el.querySelector(`[data-section="${CSS.escape(route.arg)}"]`);
      if (target) {
        target.scrollIntoView({ block: 'start' });
        target.classList.add('is-highlighted');
      }
    }, 60);
  }

  return {
    el,
    destroy() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

// ---- Bausteine ------------------------------------------------------------------------------

function section(id, title, ...children) {
  return h(
    'section',
    { class: 'card settings-section', dataset: { section: id }, 'aria-label': title },
    h('h2', { class: 'card-title', text: title }),
    ...children,
  );
}

function button(label, onClick, variant = '') {
  const btn = h('button', { type: 'button', class: ['btn', variant].filter(Boolean).join(' ') }, label);
  btn.addEventListener('click', onClick);
  return btn;
}

function labeledRow(label, control) {
  return h('div', { class: 'settings-row' }, h('span', { class: 'settings-row-label', text: label }), control);
}

/**
 * Schieberegler mit Wertanzeige.
 * @param {{label: string, hint?: string, badge?: string|null, min: number, max: number, step: number, value: number, format: (v: number) => string, onInput: (v: number) => void, onCommit?: () => void}} options
 */
function rangeField({ label, hint, badge, min, max, step, value, format, onInput, onCommit }) {
  const output = h('output', { class: 'range-value', text: format(value) });
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    output.textContent = format(v);
    onInput(v);
  });
  if (onCommit) input.addEventListener('change', onCommit);
  const el = h(
    'label',
    { class: 'range-field' },
    h(
      'span',
      { class: 'range-head' },
      h('span', null, label, badge ? h('span', { class: 'range-badge', text: badge }) : null),
      output,
    ),
    input,
    hint ? h('span', { class: 'range-hint', text: hint }) : null,
  );
  return {
    el,
    sync(next) {
      if (document.activeElement === input) return;
      input.value = String(next);
      output.textContent = format(next);
    },
  };
}
