/**
 * measureView.js – Modul "Measure"
 *  - 3×3-Übersicht (Header "Measure – Level X", "Go Back") mit prozeduralen Piktogrammen und Bestwerten
 *  - Startet eine Übung im Exercise-Runner (Vorstart-Countdown mit Auto-Kalibrierung, Live-HUD)
 *  - Speichert das Ergebnis als MEASURE-Session und zeigt das Ergebnis-Overlay
 *    (End-Score, Daily Best, All Time Best, "Wiederholen" / "Zurück")
 */

import { MEASURE_DURATIONS } from '../config.js';
import { MEASURE_EXERCISES } from '../exercises.js';
import { exercisePictogram } from '../icons.js';
import { createExerciseRunner } from './exerciseRunner.js';
import { createSegmented, createTopBar, formatNumber, h, showToast } from './ui.js';

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createMeasureView(ctx) {
  const { t, settings, sessions, actions, audio } = ctx;
  const initial = settings.get();
  const level = initial.lastLevel;
  const deviceId = initial.boardProfileId;
  const el = h('section', { class: 'view view-measure' });

  /** @type {ReturnType<typeof createExerciseRunner> | null} */
  let runner = null;
  let currentExercise = null;

  const filterFor = (exercise) => ({ deviceId, mode: 'MEASURE', activityId: exercise.id, level });

  // ---- Übersicht ------------------------------------------------------------------------
  function renderOverview() {
    clearRunner();
    currentExercise = null;

    const durationSegment = createSegmented({
      label: t('measure.duration'),
      className: 'segmented-compact segmented-duration',
      options: MEASURE_DURATIONS.map((sec) => ({ value: sec, label: t('measure.durationValue', { sec }) })),
      value: settings.get().measureDurationSec,
      onChange: (sec) => settings.update({ measureDurationSec: sec }),
    });

    const topBar = createTopBar({
      title: t('measure.title'),
      subtitle: t('measure.subtitle', { level }),
      menuLabel: t('topbar.menu'),
      onMenu: () => actions.openMenu(),
      actions: [durationSegment.el],
      back: { label: t('common.goBack'), onClick: () => actions.goBack() },
    });

    const grid = h('div', { class: 'exercise-grid' }, MEASURE_EXERCISES.map(createTile));
    el.replaceChildren(topBar, h('div', { class: 'measure-main' }, grid));
  }

  function translateOptional(key) {
    const text = t(key);
    return text === key ? null : text;
  }

  function createTile(exercise) {
    const name = t(`exercise.${exercise.id}.name`);
    const tileName = translateOptional(`exercise.${exercise.id}.tile`) ?? name;
    const accent = translateOptional(`exercise.${exercise.id}.accent`);
    const { allTimeBest } = sessions.getBests(filterFor(exercise));
    const bestText = allTimeBest === null ? t('measure.noBest') : t('measure.best', { score: allTimeBest });

    const tile = h(
      'button',
      { type: 'button', class: 'exercise-tile', 'aria-label': `${name} – ${bestText}` },
      h('span', { class: 'tile-name' }, tileName, accent ? h('span', { class: 'tile-accent', text: accent }) : null),
      h('span', { class: 'tile-picto', html: exercisePictogram(exercise.id) }),
      h('span', { class: 'tile-best', text: bestText }),
    );
    tile.addEventListener('click', () => startExercise(exercise));
    return tile;
  }

  // ---- Übung ----------------------------------------------------------------------------
  function startExercise(exercise) {
    // Synchron im Klick: Sensor-Freigabe (iOS), AudioContext und Wake Lock
    actions.prepareSession();
    clearRunner();
    currentExercise = exercise;
    const s = settings.get();
    runner = createExerciseRunner({
      ctx,
      exercise,
      durationSec: s.measureDurationSec,
      countdownSec: s.mountCountdownSec,
      onFinish: (result) => showResult(exercise, result),
      onAbort: (reason) => {
        if (reason === 'hidden') showToast(t('measure.aborted'));
        renderOverview();
      },
    });
    el.replaceChildren(runner.el);
    document.body.classList.add('exercise-active');
    runner.start();
  }

  function showResult(exercise, result) {
    const filter = filterFor(exercise);
    const before = sessions.getBests(filter);
    const saved = sessions.add({ ...filter, durationSec: result.durationSec, rawValue: result.rawValue, score: result.score });
    if (!saved.ok) showToast(t('measure.saveFailed'), 4000);
    const bests = saved.ok
      ? sessions.getBests(filter)
      : {
          dailyBest: Math.max(before.dailyBest ?? 0, result.score),
          allTimeBest: Math.max(before.allTimeBest ?? 0, result.score),
        };

    const isNewAllTime = before.allTimeBest !== null && result.score > before.allTimeBest;
    const isNewDaily = !isNewAllTime && before.dailyBest !== null && result.score > before.dailyBest;
    const isFirst = before.count === 0;
    audio.play(isNewAllTime ? 'fanfare' : 'finish');

    let badge = null;
    if (isNewAllTime) badge = t('measure.result.newAllTime');
    else if (isNewDaily) badge = t('measure.result.newDaily');
    else if (isFirst) badge = t('measure.result.first');

    const detail =
      exercise.kind === 'tag'
        ? t('measure.result.tag', { caught: result.caught, target: result.targetCount })
        : t('measure.result.inTarget', { sec: formatNumber(result.timeInTolerance, 1) });

    const repeatButton = h('button', { type: 'button', class: 'btn btn-primary' }, t('measure.result.repeat'));
    repeatButton.addEventListener('click', () => startExercise(exercise));
    const backButton = h('button', { type: 'button', class: 'btn' }, t('measure.result.back'));
    backButton.addEventListener('click', () => renderOverview());

    const titleId = `result-title-${Date.now()}`;
    const overlay = h(
      'div',
      { class: 'result-overlay' },
      h(
        'div',
        { class: 'result-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('p', { class: 'result-exercise', id: titleId, text: `${t(`exercise.${exercise.id}.name`)} · L${level}` }),
        h('div', { class: 'result-score', text: String(result.score) }),
        h('p', { class: 'result-unit', text: t('measure.result.score') }),
        badge ? h('p', { class: 'result-badge', text: badge }) : null,
        h('p', { class: 'result-detail', text: detail }),
        h(
          'dl',
          { class: 'result-bests' },
          h(
            'div',
            { class: 'result-best result-best-daily' },
            h('dt', { text: t('measure.result.dailyBest') }),
            h('dd', { text: formatBest(bests.dailyBest) }),
          ),
          h(
            'div',
            { class: 'result-best result-best-alltime' },
            h('dt', { text: t('measure.result.allTimeBest') }),
            h('dd', { text: formatBest(bests.allTimeBest) }),
          ),
        ),
        h('div', { class: 'result-actions' }, repeatButton, backButton),
      ),
    );
    runner.el.append(overlay);
    repeatButton.focus();
  }

  function formatBest(value) {
    return value === null || value === undefined ? '–' : String(value);
  }

  function clearRunner() {
    if (runner) {
      runner.destroy();
      runner = null;
    }
    document.body.classList.remove('exercise-active');
  }

  // Escape: laufende Übung abbrechen bzw. vom Ergebnis zurück zur Übersicht (Desktop/Simulator)
  function onKeyDown(event) {
    if (event.key !== 'Escape' || !currentExercise || !runner) return;
    if (document.querySelector('.drawer')) return;
    event.preventDefault();
    if (runner.phase === 'countdown' || runner.phase === 'running') runner.abort('user');
    else renderOverview();
  }
  window.addEventListener('keydown', onKeyDown);

  renderOverview();

  return {
    el,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      clearRunner();
    },
  };
}
