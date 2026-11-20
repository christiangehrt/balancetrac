/**
 * trainView.js – Modul "Train" (geführter Hands-Free-Zirkel)
 *  - Konfigurator: Multi-Auswahl der 9 Measure-Übungen, 3 Schnell-Presets, Gesamtdauer 2–30 min
 *  - Ablauf: Stationen à 45–60 s, dazwischen 10-Sekunden-Pausen mit großer Vorschau auf die nächste
 *    Übung, 3-2-1-Beep und Auto-Kalibrierung; Pausen-Ton, Start-Ton, Abschluss-Fanfare,
 *    optionale Sprachansage des nächsten Übungsnamens
 *  - Nach Abschluss: Durchschnittsscore aller Stationen als TRAIN-Session speichern
 */

import { getExercise, MEASURE_EXERCISES } from '../exercises.js';
import { formatTimeMMSS } from '../games/gameEngine.js';
import { exercisePictogram } from '../icons.js';
import {
  circuitScore,
  clampMinutes,
  matchPreset,
  normalizeSelection,
  planCircuit,
  TRAIN_DEFAULT_EXERCISES,
  TRAIN_MAX_MINUTES,
  TRAIN_MIN_MINUTES,
  TRAIN_PAUSE_SEC,
  TRAIN_PRESETS,
} from '../trainPlanner.js';
import { createExerciseRunner } from './exerciseRunner.js';
import { createToggle, createTopBar, h, openDialog, setText, showToast } from './ui.js';

const TRAIN_ACTIVITY_ID = 'TRAIN_CIRCUIT';

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createTrainView(ctx) {
  const { t, settings, sessions, actions, audio, wakeLock } = ctx;
  const initial = settings.get();
  const level = initial.lastLevel;
  const deviceId = initial.boardProfileId;
  const filter = { deviceId, mode: 'TRAIN', activityId: TRAIN_ACTIVITY_ID, level };
  const el = h('section', { class: 'view view-train' });

  let selection = normalizeSelection(initial.trainExercises);
  if (selection.length === 0) selection = [...TRAIN_DEFAULT_EXERCISES];
  let minutes = clampMinutes(initial.trainMinutes);
  /** @type {ReturnType<typeof createExerciseRunner> | null} */
  let runner = null;
  let plan = null;
  let results = [];
  let running = false;

  function planText(currentPlan) {
    if (!currentPlan) return t('train.selectAtLeastOne');
    const count = currentPlan.stations.length;
    const seconds = Math.round(currentPlan.workSec / count);
    return count === 1
      ? t('train.planOne', { seconds })
      : t('train.plan', { stations: count, seconds, pause: TRAIN_PAUSE_SEC });
  }

  function topBar() {
    return createTopBar({
      title: t('train.title'),
      subtitle: t('train.subtitle', { level }),
      menuLabel: t('topbar.menu'),
      onMenu: () => actions.openMenu(),
      back: { label: t('common.goBack'), onClick: () => actions.goBack() },
    });
  }

  // ---- Konfigurator ---------------------------------------------------------------------
  function renderConfigurator() {
    clearRunner();
    running = false;
    document.body.classList.remove('exercise-active');

    const tiles = MEASURE_EXERCISES.map((exercise) => {
      const tile = h(
        'button',
        { type: 'button', class: 'train-tile', dataset: { id: exercise.id } },
        h('span', { class: 'train-tile-picto', html: exercisePictogram(exercise.id), 'aria-hidden': 'true' }),
        h('span', { class: 'train-tile-name', text: t(`exercise.${exercise.id}.name`) }),
      );
      tile.addEventListener('click', () => {
        const next = selection.includes(exercise.id) ? selection.filter((id) => id !== exercise.id) : [...selection, exercise.id];
        setSelection(next);
      });
      return tile;
    });

    const presetButtons = TRAIN_PRESETS.map((preset) => {
      const btn = h('button', { type: 'button', class: 'btn preset-btn' }, t(preset.nameKey));
      btn.addEventListener('click', () => setSelection([...preset.exercises]));
      return { preset, btn };
    });

    const minutesValue = h('output', { class: 'train-minutes hud' });
    const minutesInput = h('input', {
      type: 'range',
      min: String(TRAIN_MIN_MINUTES),
      max: String(TRAIN_MAX_MINUTES),
      step: '1',
      'aria-label': t('train.duration'),
    });
    minutesInput.value = String(minutes);
    minutesInput.addEventListener('input', () => {
      minutes = clampMinutes(Number(minutesInput.value));
      settings.update({ trainMinutes: minutes });
      refresh();
    });

    const summary = h('p', { class: 'train-plan', 'aria-live': 'polite' });
    const voiceToggle = createToggle({
      label: t('train.voice'),
      checked: settings.get().voiceEnabled,
      onChange: (on) => {
        settings.update({ voiceEnabled: on });
        if (on) {
          audio.unlock();
          audio.speak(t('settings.measure.voiceSample'));
        }
      },
    });
    const startButton = h('button', { type: 'button', class: 'btn btn-primary train-start' }, t('train.start'));
    startButton.addEventListener('click', () => startCircuit());

    const { allTimeBest } = sessions.getBests(filter);
    const bestText = allTimeBest === null ? t('measure.noBest') : t('measure.best', { score: allTimeBest });

    function refresh() {
      tiles.forEach((tile) => tile.setAttribute('aria-pressed', String(selection.includes(tile.dataset.id))));
      const active = matchPreset(selection);
      presetButtons.forEach(({ preset, btn }) => btn.setAttribute('aria-pressed', String(preset.id === active)));
      setText(minutesValue, t('train.minutes', { minutes }));
      const currentPlan = planCircuit(selection, minutes);
      setText(summary, planText(currentPlan));
      startButton.disabled = !currentPlan;
    }

    function setSelection(next) {
      selection = normalizeSelection(next);
      settings.update({ trainExercises: selection });
      refresh();
    }

    el.replaceChildren(
      topBar(),
      h(
        'div',
        { class: 'train-main' },
        h(
          'section',
          { class: 'card train-exercises', 'aria-label': t('train.exercises') },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: t('train.exercises') }), h('span', { class: 'train-best', text: bestText })),
          h('div', { class: 'train-tiles' }, tiles),
        ),
        h(
          'section',
          { class: 'card train-settings' },
          h('h2', { class: 'card-title', text: t('train.presets') }),
          h('div', { class: 'preset-row' }, presetButtons.map(({ btn }) => btn)),
          h('div', { class: 'train-duration' }, h('span', { class: 'settings-row-label', text: t('train.duration') }), minutesValue),
          minutesInput,
          summary,
          startButton,
          voiceToggle.el,
        ),
      ),
    );
    refresh();
  }

  // ---- Ablauf ---------------------------------------------------------------------------
  function startCircuit() {
    // Synchron im Klick: Sensor-Freigabe (iOS), AudioContext und Wake Lock
    actions.prepareSession();
    plan = planCircuit(selection, minutes);
    if (!plan) return;
    results = [];
    running = true;
    document.body.classList.add('exercise-active');
    runStation(0);
  }

  function runStation(index) {
    clearRunner();
    if (!running || !plan) return;
    const station = plan.stations[index];
    const exercise = getExercise(station.exerciseId);
    const name = t(`exercise.${exercise.id}.name`);
    const first = index === 0;
    const count = plan.stations.length;
    wakeLock.request();

    runner = createExerciseRunner({
      ctx,
      exercise,
      durationSec: station.workSec,
      countdownSec: first ? settings.get().mountCountdownSec : TRAIN_PAUSE_SEC,
      prestartLabel: first ? t('train.firstLabel', { count }) : t('train.pauseLabel', { index: index + 1, count }),
      prestartHint: first ? undefined : t('train.pauseHint'),
      showPictogram: true,
      tickMode: first ? 'all' : 'last3',
      prestartSound: first ? undefined : 'pause',
      announce: first ? t('train.firstUp', { name }) : t('train.nextUp', { name }),
      contextLabel: t('train.station', { index: index + 1, count }),
      onStopRequest: () => confirmStop(),
      onFinish: (result) => {
        results.push({ exerciseId: exercise.id, score: result.score });
        if (index + 1 < count) runStation(index + 1);
        else finishCircuit();
      },
      onAbort: (reason) => {
        if (reason === 'hidden') showToast(t('train.aborted'), 3500);
        renderConfigurator();
      },
    });
    el.replaceChildren(runner.el);
    runner.start();
  }

  async function confirmStop() {
    const stop = await openDialog({
      title: t('train.stopTitle'),
      message: t('train.stopText'),
      actions: [
        { label: t('train.stopCancel'), value: false, variant: 'primary' },
        { label: t('train.stopConfirm'), value: true, variant: 'danger' },
      ],
      cancelValue: false,
    });
    if (stop && runner) runner.abort('user');
  }

  function finishCircuit() {
    clearRunner();
    running = false;
    document.body.classList.remove('exercise-active');
    const score = circuitScore(results.map((result) => result.score));
    const before = sessions.getBests(filter);
    const saved = sessions.add({ ...filter, durationSec: plan.totalSec, rawValue: results.length, score });
    if (!saved.ok) showToast(t('measure.saveFailed'), 4000);
    const bests = saved.ok
      ? sessions.getBests(filter)
      : { dailyBest: Math.max(before.dailyBest ?? 0, score), allTimeBest: Math.max(before.allTimeBest ?? 0, score) };
    const isNewAllTime = before.allTimeBest !== null && score > before.allTimeBest;
    const isNewDaily = !isNewAllTime && before.dailyBest !== null && score > before.dailyBest;
    audio.play('fanfare');
    audio.speak(t('train.doneSpeech', { score }));

    let badge = null;
    if (isNewAllTime) badge = t('measure.result.newAllTime');
    else if (isNewDaily) badge = t('measure.result.newDaily');
    else if (before.count === 0) badge = t('train.firstResult');

    const againButton = h('button', { type: 'button', class: 'btn btn-primary' }, t('train.again'));
    againButton.addEventListener('click', () => startCircuit());
    const backButton = h('button', { type: 'button', class: 'btn' }, t('train.back'));
    backButton.addEventListener('click', () => renderConfigurator());

    const stationList = h(
      'ol',
      { class: 'train-station-list', 'aria-label': t('train.stationsTitle') },
      results.map((result, index) =>
        h(
          'li',
          { class: 'train-station' },
          h('span', { class: 'train-station-index', text: String(index + 1) }),
          h('span', { class: 'train-station-name', text: t(`exercise.${result.exerciseId}.name`) }),
          h('span', { class: 'train-station-score', text: String(result.score) }),
        ),
      ),
    );

    el.replaceChildren(
      topBar(),
      h(
        'div',
        { class: 'train-summary' },
        h(
          'div',
          { class: 'result-card train-result', role: 'region', 'aria-label': t('train.done') },
          h('p', { class: 'result-exercise', text: `${t('train.done')} · L${level}` }),
          h('div', { class: 'result-score', text: String(score) }),
          h('p', { class: 'result-unit', text: t('train.average') }),
          badge ? h('p', { class: 'result-badge', text: badge }) : null,
          h('p', {
            class: 'result-detail',
            text: t('train.doneDetail', { stations: results.length, time: formatTimeMMSS(plan.totalSec) }),
          }),
          h(
            'dl',
            { class: 'result-bests' },
            h('div', { class: 'result-best result-best-daily' }, h('dt', { text: t('measure.result.dailyBest') }), h('dd', { text: formatBest(bests.dailyBest) })),
            h('div', { class: 'result-best result-best-alltime' }, h('dt', { text: t('measure.result.allTimeBest') }), h('dd', { text: formatBest(bests.allTimeBest) })),
          ),
          stationList,
          h('div', { class: 'result-actions' }, againButton, backButton),
        ),
      ),
    );
    againButton.focus();
  }

  function formatBest(value) {
    return value === null || value === undefined ? '–' : String(value);
  }

  function clearRunner() {
    if (runner) {
      runner.destroy();
      runner = null;
    }
  }

  renderConfigurator();

  return {
    el,
    destroy() {
      running = false;
      clearRunner();
      document.body.classList.remove('exercise-active');
    },
  };
}
