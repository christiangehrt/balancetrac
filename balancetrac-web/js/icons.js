/**
 * icons.js – Prozedurale SVG-Grafiken für BalanceTrac (keine externen Assets).
 *
 * - Board-Seitenansicht mit 1–3 Höhenpads
 * - 9 Bewegungs-Piktogramme der Measure-Übungen
 * - UI-Symbole und Querformat-Illustration
 * Das Modul ist DOM-frei und liefert ausschließlich SVG-Strings.
 */

import { arcPath, chasePath } from './exercises.js';

const UI_ICON_PATHS = Object.freeze({
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  calibrate:
    '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>' +
    '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  fullscreenEnter: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  fullscreenExit: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  joystick: '<circle cx="12" cy="6.5" r="3"/><path d="M12 9.5V16"/><rect x="4.5" y="16" width="15" height="5" rx="2"/>',
  chevronLeft: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  chevronRight: '<path d="M9 4.5 16.5 12 9 19.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  backup: '<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 16v3h14v-3"/>',
  sensor: '<rect x="7.5" y="3" width="9" height="18" rx="2"/><path d="M11 18h2M4 9c-1.2 2-1.2 4 0 6M20 9c1.2 2 1.2 4 0 6"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>' +
    '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
});

/** @returns {string[]} Namen aller verfügbaren UI-Symbole */
export function listUiIcons() {
  return Object.keys(UI_ICON_PATHS);
}

/**
 * Liefert ein Inline-SVG-Symbol (24×24, Strichstärke 2, Farbe = currentColor).
 * @param {string} name
 * @param {string} [className]
 * @returns {string}
 */
export function uiIcon(name, className = '') {
  const body = UI_ICON_PATHS[name];
  if (!body) throw new Error(`Unbekanntes Symbol: ${name}`);
  const classes = ['icon', className].filter(Boolean).join(' ');
  return (
    `<svg class="${classes}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Illustration für den Hinweis "Bitte ins Querformat drehen". */
export function rotateDeviceIllustration() {
  return (
    '<svg class="rotate-illustration" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
    '<path d="M24 34a44 44 0 0 1 52-14" fill="none" stroke="#B9BFC8" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M70 12l8 8-10 5" fill="none" stroke="#B9BFC8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<g class="rotate-phone">' +
    '<rect x="42" y="30" width="36" height="66" rx="7" fill="#FFFFFF" stroke="#1E2227" stroke-width="4"/>' +
    '<rect x="48" y="38" width="24" height="46" rx="2" fill="#FDE8DC"/>' +
    '<circle cx="60" cy="90" r="2.5" fill="#1E2227"/>' +
    '<circle cx="60" cy="61" r="6" fill="#F26522"/>' +
    '</g>' +
    '</svg>'
  );
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------------------------
// Bewegungs-Piktogramme der 9 Measure-Übungen (viewBox 120 × 80)
// ---------------------------------------------------------------------------------------------

const PICTO_TUBE_OUTER = '#D3D7DD';
const PICTO_TUBE_INNER = '#F1F2F5';

function pictoTube(d, width = 12) {
  return (
    `<path d="${d}" fill="none" stroke="${PICTO_TUBE_OUTER}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${PICTO_TUBE_INNER}" stroke-width="${(width * 0.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function pictoBall(x, y, kind, r = 6) {
  const fill = kind === 'player' ? '#F26522' : '#B9BFC8';
  const stroke = kind === 'player' ? '#B9480F' : '#7A818B';
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;
}

function pointsToPath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

/** Bogenpfeil um (cx, cy); Winkel in Grad in Bildschirm-Koordinaten (y nach unten, steigend = Uhrzeigersinn). */
function pictoArrowArc(cx, cy, r, fromDeg, toDeg) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const from = toRad(fromDeg);
  const to = toRad(toDeg);
  const start = [cx + r * Math.cos(from), cy + r * Math.sin(from)];
  const end = [cx + r * Math.cos(to), cy + r * Math.sin(to)];
  const sweep = toDeg > fromDeg ? 1 : 0;
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const dir = sweep ? 1 : -1;
  const tangent = [-Math.sin(to) * dir, Math.cos(to) * dir];
  const normal = [-tangent[1], tangent[0]];
  const tip = [end[0] + tangent[0] * 5, end[1] + tangent[1] * 5];
  const left = [end[0] + normal[0] * 3.6, end[1] + normal[1] * 3.6];
  const right = [end[0] - normal[0] * 3.6, end[1] - normal[1] * 3.6];
  return (
    `<path d="M${start[0].toFixed(1)} ${start[1].toFixed(1)} A${r} ${r} 0 ${large} ${sweep} ${end[0].toFixed(1)} ${end[1].toFixed(1)}" ` +
    `fill="none" stroke="#B9480F" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M${tip[0].toFixed(1)} ${tip[1].toFixed(1)} L${left[0].toFixed(1)} ${left[1].toFixed(1)} L${right[0].toFixed(1)} ${right[1].toFixed(1)} Z" fill="#B9480F"/>`
  );
}

function orbitPicto(direction) {
  const cx = 60;
  const cy = 40;
  const r = 22;
  const at = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const clockwise = direction === 'cw';
  const target = at(clockwise ? -50 : -130);
  const player = at(clockwise ? -92 : -88);
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PICTO_TUBE_OUTER}" stroke-width="11"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PICTO_TUBE_INNER}" stroke-width="5.5"/>` +
    (clockwise ? pictoArrowArc(cx, cy, 33, 55, 125) : pictoArrowArc(cx, cy, 33, 125, 55)) +
    pictoBall(target[0], target[1], 'target') +
    pictoBall(player[0], player[1], 'player')
  );
}

function twistPicto(kind) {
  const offsetY = kind === 'rear' ? 24 : 56;
  const map = (p) => [60 + p.x * 58, offsetY - p.y * 70];
  const path = pointsToPath(arcPath(kind, 32).map(map));
  const along = (x) => map(arcPath(kind, 1, Math.abs(x))[x < 0 ? 0 : 1]);
  const target = along(0.3);
  const player = along(0.14);
  return pictoTube(path, 11) + pictoBall(target[0], target[1], 'target') + pictoBall(player[0], player[1], 'player');
}

const PICTOGRAM_BUILDERS = Object.freeze({
  BULLS_EYE: () =>
    '<circle cx="60" cy="40" r="31" fill="#D3D7DD"/><circle cx="60" cy="40" r="23" fill="#FFFFFF"/>' +
    '<circle cx="60" cy="40" r="15" fill="#D3D7DD"/><circle cx="60" cy="40" r="7" fill="#FFFFFF"/>' +
    pictoBall(63, 38, 'player', 5.5),
  SIDE_TO_SIDE: () => pictoTube('M16 40 H104') + pictoBall(60, 40, 'target') + pictoBall(71, 40, 'player'),
  FRONT_TO_BACK: () => pictoTube('M60 9 V71') + pictoBall(60, 33, 'target') + pictoBall(60, 45, 'player'),
  CHASE: () => {
    const points = chasePath(120).map((p) => [60 + p.x * 46, 40 - p.y * 46]);
    const target = points[22];
    const player = points[14];
    return (
      `<path d="${pointsToPath(points)}" fill="none" stroke="#B9BFC8" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 6"/>` +
      pictoBall(target[0], target[1], 'target') +
      pictoBall(player[0], player[1], 'player')
    );
  },
  ORBIT_CW: () => orbitPicto('cw'),
  ORBIT_CCW: () => orbitPicto('ccw'),
  TAG: () =>
    '<path d="M38 54 L80 28" fill="none" stroke="#D3D7DD" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 6"/>' +
    '<circle cx="84" cy="25" r="12" fill="none" stroke="#4CAF50" stroke-width="2.5" stroke-dasharray="4 3"/>' +
    pictoBall(84, 25, 'target') +
    pictoBall(34, 56, 'player'),
  FRONT_TWIST: () => twistPicto('front'),
  REAR_TWIST: () => twistPicto('rear'),
});

/**
 * Bewegungs-Piktogramm einer Measure-Übung.
 * @param {string} exerciseId
 * @returns {string} SVG-Markup (dekorativ, aria-hidden)
 */
export function exercisePictogram(exerciseId) {
  const build = PICTOGRAM_BUILDERS[exerciseId];
  if (!build) throw new Error(`Unbekannte Übung: ${exerciseId}`);
  return (
    '<svg class="pictogram" viewBox="0 0 120 80" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">' +
    build() +
    '</svg>'
  );
}

let svgInstanceCounter = 0;

/**
 * Zeichnet ein Board in der Seitenansicht.
 * @param {{profileId?: string, shape?: string, pads?: number, title?: string, animate?: boolean}} [options]
 * @returns {string} SVG-Markup
 */
export function createBoardSvg(options = {}) {
  const pads = Math.min(3, Math.max(1, Math.round(Number(options.pads) || 1)));
  const title = options.title ?? '';
  const animate = options.animate !== false;
  switch (options.shape ?? 'mpad') {
    case 'mpad':
    default:
      return mPadSideView(pads, title, animate);
  }
}

/**
 * M-Pad-artiges Board: zwei Fußplatten auf einer Mittelschiene, darunter eine Kuppel
 * auf 1–3 gestapelten orangen Gummi-Höhenpads.
 */
function mPadSideView(padCount, title, animate) {
  const id = `bt-board-${++svgInstanceCounter}`;
  const cx = 400;
  const groundY = 236;
  const padH = 22;
  const padW = 136;
  const padsTop = groundY - padCount * padH;
  const hubH = 26;
  const hubTop = padsTop - hubH;
  const barH = 18;
  const barTop = hubTop - barH + 6;
  const plateH = 32;
  const plateTop = barTop - 9;

  const padRects = [];
  for (let i = 0; i < padCount; i += 1) {
    const y = groundY - (i + 1) * padH;
    padRects.push(
      `<rect x="${cx - padW / 2}" y="${y + 1}" width="${padW}" height="${padH - 2}" rx="9" ` +
        `fill="url(#${id}-pad)" stroke="#A8420E" stroke-width="2"/>`,
    );
  }

  const gripLines = [];
  for (let x = 70; x <= 290; x += 22) {
    gripLines.push(`<path d="M${x} ${plateTop + 7}h12" />`);
    gripLines.push(`<path d="M${x + 438} ${plateTop + 7}h12" />`);
  }

  const rock = animate
    ? `<animateTransform attributeName="transform" type="rotate" ` +
      `values="-1.6 ${cx} ${padsTop};1.6 ${cx} ${padsTop};-1.6 ${cx} ${padsTop}" keyTimes="0;0.5;1" ` +
      `calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" dur="6s" repeatCount="indefinite"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 96 800 160" role="img" preserveAspectRatio="xMidYMid meet">` +
    (title ? `<title>${escapeXml(title)}</title>` : '') +
    `<defs>` +
    `<linearGradient id="${id}-pad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#FF8A45"/><stop offset="0.55" stop-color="#F26522"/><stop offset="1" stop-color="#D3561A"/>` +
    `</linearGradient>` +
    `<linearGradient id="${id}-bar" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#F4F6F8"/><stop offset="0.5" stop-color="#AEB4BD"/><stop offset="1" stop-color="#D9DDE3"/>` +
    `</linearGradient>` +
    `<linearGradient id="${id}-plate" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#5A616B"/><stop offset="1" stop-color="#2E333A"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<ellipse cx="${cx}" cy="${groundY + 6}" rx="330" ry="9" fill="#1E2227" opacity="0.12"/>` +
    padRects.join('') +
    `<g>` +
    rock +
    `<path d="M${cx - 84} ${padsTop + 2} Q${cx - 84} ${hubTop} ${cx - 44} ${hubTop} L${cx + 44} ${hubTop} ` +
    `Q${cx + 84} ${hubTop} ${cx + 84} ${padsTop + 2} Z" fill="#3A3F47"/>` +
    `<rect x="286" y="${barTop}" width="228" height="${barH}" rx="6" fill="url(#${id}-bar)" stroke="#8E959F" stroke-width="1.5"/>` +
    `<rect x="36" y="${plateTop}" width="292" height="${plateH}" rx="16" fill="url(#${id}-plate)"/>` +
    `<rect x="472" y="${plateTop}" width="292" height="${plateH}" rx="16" fill="url(#${id}-plate)"/>` +
    `<g stroke="#7A818B" stroke-width="2.5" stroke-linecap="round" fill="none">${gripLines.join('')}</g>` +
    `</g>` +
    `</svg>`
  );
}
