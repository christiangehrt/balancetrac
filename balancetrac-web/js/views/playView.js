/**
 * playView.js – Modul "Play"
 *  - Spielauswahl (dunkles Theme) mit Live-Vorschau beider Spiele, Bestwerten und Optionen
 *    (Labyrinth 1–5 des gewählten Levels, Feuermodus für Astro Guard)
 *  - Startet das Spiel in einer gemeinsamen Game-Session (gameEngine.js)
 *  - Speichert das Ergebnis als PLAY-Session und zeigt das Ergebnis-Overlay
 */

import { SHOOTER_FIRE_MODES } from '../config.js';
import { ASTRO_GUARD_ACTIVITY_ID, createAstroGuardGame } from '../games/astroGuard.js';
import { createGameSession, formatTimeMMSS } from '../games/gameEngine.js';
import { createLabyrinthGame, LABYRINTH_ACTIVITY_ID } from '../games/labyrinth.js';
import { getMazesForLevel } from '../games/mazeData.js';
import { createHiDpiCanvas } from './canvasKit.js';
import { createSegmented, createTopBar, h, setText, showToast } from './ui.js';

/** Zuletzt gewähltes Labyrinth je Level (bleibt für die Sitzung erhalten). */
const selectedMaze = { 1: 1, 2: 1, 3: 1 };

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @returns {{el: HTMLElement, mounted: () => void, destroy: () => void}}
 */
export function createPlayView(ctx) {
  const { t, settings, sessions, actions, audio } = ctx;
  const initial = settings.get();
  const level = initial.lastLevel;
  const deviceId = initial.boardProfileId;
  const mazes = getMazesForLevel(level);
  const el = h('section', { class: 'view view-play' });

  let session = null;
  let previews = [];
  let currentKind = null;

  const filterFor = (activityId) => ({ deviceId, mode: 'PLAY', activityId, level });

  function currentMaze() {
    const index = Math.min(mazes.length, Math.max(1, selectedMaze[level] ?? 1));
    return mazes[index - 1];
  }

  function highscorePoints() {
    let best = null;
    for (const entry of sessions.query(filterFor(ASTRO_GUARD_ACTIVITY_ID))) {
      if (best === null || entry.rawValue > best) best = entry.rawValue;
    }
    return best;
  }

  // ---- Auswahl --------------------------------------------------------------------------
  function renderSelection() {
    clearSession();
    currentKind = null;

    const topBar = createTopBar({
      title: t('play.title'),
      subtitle: t('play.subtitle', { level }),
      menuLabel: t('topbar.menu'),
      onMenu: () => actions.openMenu(),
      back: { label: t('common.goBack'), onClick: () => actions.goBack() },
    });

    // Labyrinth-Karte
    const labyrinthPreview = createPreview((g, width, height) => {
      createLabyrinthGame({ maze: currentMaze(), t }).render(g, width, height, { time: 0.6 });
    });
    const mazeSegment = createSegmented({
      label: t('play.labyrinth.maze'),
      className: 'segmented-compact',
      options: mazes.map((maze) => ({ value: maze.index, label: String(maze.index) })),
      value: currentMaze().index,
      onChange: (index) => {
        selectedMaze[level] = index;
        labyrinthPreview.redraw();
        setText(labyrinthPar, t('play.labyrinth.par', { time: formatTimeMMSS(currentMaze().parSec) }));
      },
    });
    const labyrinthPar = h('span', { class: 'game-card-meta', text: t('play.labyrinth.par', { time: formatTimeMMSS(currentMaze().parSec) }) });
    const labyrinthCard = gameCard({
      preview: labyrinthPreview,
      name: t('activity.LABYRINTH.name'),
      description: t('play.labyrinth.description') + (level === 3 ? ` ${t('play.labyrinth.holes')}` : ''),
      bestText: bestLine(LABYRINTH_ACTIVITY_ID),
      options: [h('div', { class: 'game-option' }, h('span', { class: 'game-option-label', text: t('play.labyrinth.maze') }), mazeSegment.el), labyrinthPar],
      onStart: () => startGame(LABYRINTH_ACTIVITY_ID),
    });

    // Astro-Guard-Karte
    const astroPreview = createPreview((g, width, height) => {
      createAstroGuardGame({ level, t, seed: 4 }).render(g, width, height, { time: 1.2 });
    });
    const fireSegment = createSegmented({
      label: t('play.astro.fireMode'),
      className: 'segmented-compact',
      options: SHOOTER_FIRE_MODES.map((mode) => ({ value: mode, label: t(`play.astro.fireMode.${mode}`) })),
      value: settings.get().shooterFireMode,
      onChange: (mode) => settings.update({ shooterFireMode: mode }),
    });
    const highscore = highscorePoints();
    const astroCard = gameCard({
      preview: astroPreview,
      name: t('activity.ASTRO_GUARD.name'),
      description: t('play.astro.description'),
      bestText: `${bestLine(ASTRO_GUARD_ACTIVITY_ID)}${highscore === null ? '' : ` · ${t('play.highscore', { points: highscore })}`}`,
      options: [h('div', { class: 'game-option' }, h('span', { class: 'game-option-label', text: t('play.astro.fireMode') }), fireSegment.el)],
      onStart: () => startGame(ASTRO_GUARD_ACTIVITY_ID),
    });

    previews = [labyrinthPreview, astroPreview];
    el.replaceChildren(topBar, h('div', { class: 'play-main' }, h('div', { class: 'game-cards' }, labyrinthCard, astroCard)));
    for (const preview of previews) preview.refresh();
  }

  function bestLine(activityId) {
    const { allTimeBest } = sessions.getBests(filterFor(activityId));
    return allTimeBest === null ? t('measure.noBest') : t('measure.best', { score: allTimeBest });
  }

  function createPreview(draw) {
    const host = h('div', { class: 'game-preview', 'aria-hidden': 'true' });
    const stage = createHiDpiCanvas(host, { className: 'stage-canvas', onResize: () => redraw() });
    function redraw() {
      if (stage.beginFrame()) draw(stage.ctx, stage.width, stage.height);
    }
    return {
      host,
      redraw,
      refresh: () => stage.refresh(),
      destroy: () => stage.destroy(),
    };
  }

  function gameCard({ preview, name, description, bestText, options, onStart }) {
    const startButton = h('button', { type: 'button', class: 'btn btn-primary game-start' }, t('play.start'));
    startButton.addEventListener('click', onStart);
    return h(
      'article',
      { class: 'game-card' },
      preview.host,
      h(
        'div',
        { class: 'game-card-body' },
        h('div', { class: 'game-card-head' }, h('h2', { class: 'game-card-title', text: name }), h('span', { class: 'game-card-best', text: bestText })),
        h('p', { class: 'game-card-text', text: description }),
        h('div', { class: 'game-card-options' }, options),
        startButton,
      ),
    );
  }

  // ---- Spiel ----------------------------------------------------------------------------
  function startGame(kind) {
    // Synchron im Klick: Sensor-Freigabe (iOS), AudioContext und Wake Lock
    actions.prepareSession();
    clearSession();
    currentKind = kind;
    const s = settings.get();
    let game;
    let title;
    let instruction;
    if (kind === LABYRINTH_ACTIVITY_ID) {
      const maze = currentMaze();
      game = createLabyrinthGame({ maze, audio, t });
      title = `${t('activity.LABYRINTH.name')} ${maze.index}/${mazes.length}`;
      instruction = t('play.labyrinth.instruction') + (maze.holes.length > 0 ? ` ${t('play.labyrinth.holes')}` : '');
    } else {
      game = createAstroGuardGame({ level, fireMode: s.shooterFireMode, audio, t });
      title = t('activity.ASTRO_GUARD.name');
      instruction = t('play.astro.instruction', {
        fire: t(s.shooterFireMode === 'pitch' ? 'play.astro.firePitch' : 'play.astro.fireAuto'),
      });
    }
    session = createGameSession({
      ctx,
      game,
      title,
      instruction,
      countdownSec: s.mountCountdownSec,
      onFinish: (result) => showResult(kind, result),
      onAbort: () => renderSelection(),
    });
    el.replaceChildren(session.el);
    document.body.classList.add('exercise-active');
    session.start();
  }

  function showResult(kind, result) {
    const filter = filterFor(result.activityId);
    const before = sessions.getBests(filter);
    const previousHighscore = kind === ASTRO_GUARD_ACTIVITY_ID ? highscorePoints() : null;
    const saved = sessions.add({ ...filter, durationSec: result.durationSec, rawValue: result.rawValue, score: result.score });
    if (!saved.ok) showToast(t('measure.saveFailed'), 4000);
    const bests = saved.ok
      ? sessions.getBests(filter)
      : { dailyBest: Math.max(before.dailyBest ?? 0, result.score), allTimeBest: Math.max(before.allTimeBest ?? 0, result.score) };

    const isNewAllTime = before.allTimeBest !== null && result.score > before.allTimeBest;
    const isNewDaily = !isNewAllTime && before.dailyBest !== null && result.score > before.dailyBest;
    const isNewHighscore = previousHighscore !== null && result.rawValue > previousHighscore;
    audio.play(isNewAllTime || isNewHighscore ? 'fanfare' : 'finish');

    let badge = null;
    if (isNewHighscore) badge = t('play.newHighscore');
    else if (isNewAllTime) badge = t('measure.result.newAllTime');
    else if (isNewDaily) badge = t('measure.result.newDaily');
    else if (before.count === 0) badge = t('play.firstResult');

    let heading;
    let detail;
    const buttons = [];
    if (kind === LABYRINTH_ACTIVITY_ID) {
      const maze = currentMaze();
      heading = `${t('activity.LABYRINTH.name')} ${maze.index}/${mazes.length} · L${level}`;
      detail = result.completed
        ? t('play.labyrinth.resultTime', { time: formatTimeMMSS(result.durationSec), par: formatTimeMMSS(result.parSec) }) +
          (result.falls > 0 ? ` · ${t('play.labyrinth.fallsShort', { count: result.falls })}` : '')
        : t('play.labyrinth.timeout');
      if (result.completed && maze.index < mazes.length) {
        buttons.push(
          actionButton(t('play.labyrinth.next'), 'btn-primary', () => {
            selectedMaze[level] = maze.index + 1;
            startGame(LABYRINTH_ACTIVITY_ID);
          }),
        );
      }
      buttons.push(actionButton(t('measure.result.repeat'), buttons.length ? '' : 'btn-primary', () => startGame(LABYRINTH_ACTIVITY_ID)));
    } else {
      heading = `${t('activity.ASTRO_GUARD.name')} · L${level}`;
      const highscore = Math.max(previousHighscore ?? 0, result.rawValue);
      detail = `${t('play.astro.resultDetail', { points: result.rawValue, wave: result.wave })} · ${t('play.highscore', { points: highscore })}`;
      buttons.push(actionButton(t('play.again'), 'btn-primary', () => startGame(ASTRO_GUARD_ACTIVITY_ID)));
    }
    buttons.push(actionButton(t('measure.result.back'), '', () => renderSelection()));

    const titleId = `play-result-${Date.now()}`;
    const overlay = h(
      'div',
      { class: 'result-overlay result-overlay-dark' },
      h(
        'div',
        { class: 'result-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('p', { class: 'result-exercise', id: titleId, text: heading }),
        h('div', { class: 'result-score', text: String(result.score) }),
        h('p', { class: 'result-unit', text: t('measure.result.score') }),
        badge ? h('p', { class: 'result-badge', text: badge }) : null,
        h('p', { class: 'result-detail', text: detail }),
        h(
          'dl',
          { class: 'result-bests' },
          h('div', { class: 'result-best result-best-daily' }, h('dt', { text: t('measure.result.dailyBest') }), h('dd', { text: formatBest(bests.dailyBest) })),
          h('div', { class: 'result-best result-best-alltime' }, h('dt', { text: t('measure.result.allTimeBest') }), h('dd', { text: formatBest(bests.allTimeBest) })),
        ),
        h('div', { class: 'result-actions' }, buttons),
      ),
    );
    session.el.append(overlay);
    buttons[0].focus();
  }

  function actionButton(label, variant, onClick) {
    const btn = h('button', { type: 'button', class: ['btn', variant].filter(Boolean).join(' ') }, label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function formatBest(value) {
    return value === null || value === undefined ? '–' : String(value);
  }

  function clearSession() {
    if (session) {
      session.destroy();
      session = null;
    }
    for (const preview of previews) preview.destroy();
    previews = [];
    document.body.classList.remove('exercise-active');
  }

  // Escape auf dem Ergebnis-Overlay: zurück zur Spielauswahl (im Spiel pausiert Escape)
  function onKeyDown(event) {
    if (event.key !== 'Escape' || !currentKind || !session || session.phase !== 'finished') return;
    if (document.querySelector('.drawer, .dialog')) return;
    event.preventDefault();
    renderSelection();
  }
  window.addEventListener('keydown', onKeyDown);

  renderSelection();

  return {
    el,
    mounted() {
      for (const preview of previews) preview.refresh();
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      clearSession();
    },
  };
}
