/**
 * homeView.js – Startbildschirm
 *  - Top-Bar: ≡-Menü, Gerätetitel (M-Pad), Schnell-Buttons (Simulator am Desktop, Kalibrieren, Vollbild)
 *  - Steuerungs-Panel: mode (Play | Train | Measure), level (1 | 2 | 3) und "Go!"
 *  - Board-Karussell: prozedurale Seitenansicht mit 1–3 orangen Höhenpads
 */

import { BOARD_PROFILES, LEVELS, MODES, getLevelConfig } from '../config.js';
import { createBoardSvg } from '../icons.js';
import { createSegmented, createTopBar, fullscreenButton, h, iconButton } from './ui.js';

const SWIPE_THRESHOLD_PX = 40;

/**
 * @param {object} ctx  App-Kontext aus main.js
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function createHomeView(ctx) {
  const { t, settings, actions, env } = ctx;
  const initial = settings.get();
  let profileIndex = Math.max(0, BOARD_PROFILES.findIndex((profile) => profile.id === initial.boardProfileId));
  const currentProfile = () => BOARD_PROFILES[profileIndex];

  // ---- Top-Bar --------------------------------------------------------------------------
  const topActions = [];
  let simButton = null;
  if (env.isDesktopLike) {
    simButton = iconButton({
      icon: 'joystick',
      label: t('topbar.simulator'),
      pressed: initial.simulatorEnabled,
      onClick: () => actions.setSimulator(!settings.get().simulatorEnabled),
    });
    topActions.push(simButton);
  }
  topActions.push(
    iconButton({ icon: 'calibrate', label: t('topbar.calibrate'), onClick: () => actions.calibrate() }),
    fullscreenButton(t('topbar.fullscreen'), () => actions.toggleFullscreen()),
  );

  const topBar = createTopBar({
    title: t(currentProfile().nameKey),
    menuLabel: t('topbar.menu'),
    onMenu: () => actions.openMenu(),
    actions: topActions,
  });
  const titleEl = topBar.querySelector('.topbar-title');

  // ---- Steuerungs-Panel -----------------------------------------------------------------
  const modeSegment = createSegmented({
    label: t('home.mode'),
    options: MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`) })),
    value: initial.lastMode,
    onChange: (mode) => settings.update({ lastMode: mode }),
  });

  const levelSegment = createSegmented({
    label: t('home.level'),
    options: LEVELS.map((level) => ({ value: level, label: String(level) })),
    value: initial.lastLevel,
    onChange: (level) => settings.update({ lastLevel: level }),
  });

  const goButton = h('button', { type: 'button', class: 'btn-go', title: t('home.goHint') }, t('home.go'));
  // Synchroner Aufruf im Klick-Handler: iOS-Sensorfreigabe und AudioContext brauchen die Benutzer-Geste.
  goButton.addEventListener('click', () => actions.go());

  const panel = h(
    'div',
    { class: 'control-panel' },
    modeSegment.el,
    h('div', { class: 'control-row' }, levelSegment.el, goButton),
  );

  // ---- Board-Karussell ------------------------------------------------------------------
  const stage = h('div', { class: 'board-stage' });
  const caption = h('p', { class: 'board-caption' });
  const prevButton = iconButton({
    icon: 'chevronLeft',
    label: t('board.prev'),
    className: 'carousel-arrow',
    onClick: () => stepProfile(-1),
  });
  const nextButton = iconButton({
    icon: 'chevronRight',
    label: t('board.next'),
    className: 'carousel-arrow',
    onClick: () => stepProfile(1),
  });
  const carousel = h('section', { class: 'board-carousel' }, prevButton, stage, nextButton, caption);

  function renderBoard() {
    const s = settings.get();
    const profile = currentProfile();
    const levelConfig = getLevelConfig(s.lastLevel, s);
    const boardName = t(profile.nameKey);
    const padsLabel = levelConfig.pads === 1 ? t('board.pads.one') : t('board.pads.other', { count: levelConfig.pads });
    stage.innerHTML = createBoardSvg({
      shape: profile.shape,
      pads: levelConfig.pads,
      title: t('board.svgTitle', { board: boardName, pads: padsLabel }),
      animate: !env.prefersReducedMotion,
    });
    caption.textContent = t('board.caption', { board: boardName, level: s.lastLevel, pads: padsLabel });
    titleEl.textContent = boardName;
    const single = BOARD_PROFILES.length < 2;
    prevButton.disabled = single;
    nextButton.disabled = single;
  }

  function stepProfile(delta) {
    if (BOARD_PROFILES.length < 2) return;
    profileIndex = (profileIndex + delta + BOARD_PROFILES.length) % BOARD_PROFILES.length;
    settings.update({ boardProfileId: currentProfile().id });
  }

  // Wischgeste auf der Board-Vorschau
  let swipeStartX = null;
  stage.addEventListener('pointerdown', (event) => {
    swipeStartX = event.clientX;
  });
  stage.addEventListener('pointerup', (event) => {
    if (swipeStartX === null) return;
    const dx = event.clientX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) stepProfile(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => {
    swipeStartX = null;
  });

  renderBoard();

  const unsubscribe = settings.subscribe((next, previous) => {
    if (next.lastMode !== previous.lastMode) modeSegment.set(next.lastMode);
    if (next.lastLevel !== previous.lastLevel) levelSegment.set(next.lastLevel);
    if (next.boardProfileId !== previous.boardProfileId) {
      profileIndex = Math.max(0, BOARD_PROFILES.findIndex((profile) => profile.id === next.boardProfileId));
    }
    if (
      next.lastLevel !== previous.lastLevel ||
      next.boardProfileId !== previous.boardProfileId ||
      JSON.stringify(next.levelOverrides) !== JSON.stringify(previous.levelOverrides)
    ) {
      renderBoard();
    }
    if (simButton && next.simulatorEnabled !== previous.simulatorEnabled) {
      simButton.setAttribute('aria-pressed', String(next.simulatorEnabled));
    }
  });

  const el = h('section', { class: 'view view-home' }, topBar, h('div', { class: 'home-main' }, panel, carousel));

  return {
    el,
    destroy() {
      unsubscribe();
    },
  };
}
