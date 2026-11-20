/**
 * canvasKit.js – Gemeinsame Canvas-Bausteine (HiDPI-Canvas, Kugeln, Zielscheibe, Röhren, Countdown).
 * Wird vom Sensor-Test, vom Exercise-Runner (Measure/Train) und später von den Spielen genutzt.
 */

export const COLORS = Object.freeze({
  ringDark: '#D3D7DD',
  ringLight: '#FFFFFF',
  tubeOuter: '#D9DCE1',
  tubeInner: '#EEF0F3',
  tubeEdge: '#C3C8CF',
  tolerance: '#4CAF50',
  toleranceStrong: '#2E7D32',
  orange: '#F26522',
  orangeLight: '#FFB088',
  orangeDark: '#B4470F',
  text: '#1E2227',
  textMuted: '#555C67',
});

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Legt ein HiDPI-skaliertes Canvas in einem Container an und hält die Größe per ResizeObserver aktuell.
 * Gezeichnet wird in CSS-Pixeln: beginFrame() setzt die Transformation und leert die Fläche.
 * @param {HTMLElement} container  Element mit fester Größe (position: relative)
 * @param {{className?: string, label?: string, onResize?: () => void}} [options]
 *        onResize: wird nach jeder Größenänderung aufgerufen (für Ansichten ohne Render-Schleife)
 */
export function createHiDpiCanvas(container, { className = 'stage-canvas', label, onResize } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  if (label) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
  }
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    const rect = container.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
  }

  const observer = new ResizeObserver(() => {
    resize();
    if (onResize) onResize();
  });
  observer.observe(container);
  resize();

  return {
    canvas,
    ctx,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    /** Größe sofort neu messen (z. B. direkt nach dem Einhängen in das DOM) und onResize auslösen. */
    refresh() {
      resize();
      if (onResize) onResize();
    },
    /** @returns {boolean} false, solange das Canvas keine sinnvolle Größe hat */
    beginFrame() {
      if (!ctx || width < 20 || height < 20) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      return true;
    },
    destroy() {
      observer.disconnect();
      canvas.remove();
    },
  };
}

/**
 * Kugel mit Schatten. "player" = orange Spielerkugel, "target" = weiße Zielkugel.
 * @param {CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {'player'|'target'} [kind]
 * @param {{highlight?: boolean}} [options]  highlight: grüner Ring (im Ziel)
 */
export function drawBall(g, x, y, r, kind = 'player', { highlight = false } = {}) {
  g.save();
  g.fillStyle = 'rgba(0, 0, 0, 0.18)';
  g.beginPath();
  g.ellipse(x + r * 0.25, y + r * 0.45, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
  g.fill();

  const gradient = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  if (kind === 'target') {
    gradient.addColorStop(0, '#FFFFFF');
    gradient.addColorStop(0.7, '#F4F5F7');
    gradient.addColorStop(1, '#C9CED6');
  } else {
    gradient.addColorStop(0, COLORS.orangeLight);
    gradient.addColorStop(0.45, COLORS.orange);
    gradient.addColorStop(1, COLORS.orangeDark);
  }
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  if (kind === 'target') {
    g.lineWidth = Math.max(1.5, r * 0.08);
    g.strokeStyle = '#9AA1AB';
    g.stroke();
  }
  if (highlight) {
    g.lineWidth = 3;
    g.strokeStyle = COLORS.toleranceStrong;
    g.beginPath();
    g.arc(x, y, r + 4, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/**
 * Konzentrische Zielscheibe.
 * @param {CanvasRenderingContext2D} g
 */
export function drawRings(g, cx, cy, radius) {
  const rings = [
    [1, COLORS.ringDark],
    [0.75, COLORS.ringLight],
    [0.5, COLORS.ringDark],
    [0.25, COLORS.ringLight],
  ];
  g.save();
  for (const [factor, color] of rings) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(30, 34, 39, 0.12)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - radius, cy);
  g.lineTo(cx + radius, cy);
  g.moveTo(cx, cy - radius);
  g.lineTo(cx, cy + radius);
  g.stroke();
  g.restore();
}

/**
 * Gestrichelter Toleranzkreis.
 * @param {CanvasRenderingContext2D} g
 */
export function drawToleranceCircle(g, cx, cy, radius, { active = false } = {}) {
  g.save();
  g.setLineDash([8, 6]);
  g.lineWidth = active ? 4 : 3;
  g.strokeStyle = active ? COLORS.toleranceStrong : COLORS.tolerance;
  g.beginPath();
  g.arc(cx, cy, Math.max(4, radius), 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/**
 * Röhre/Schiene entlang eines Pfades (Punkte in Bildschirmkoordinaten).
 * @param {CanvasRenderingContext2D} g
 * @param {Array<{x: number, y: number}>} points
 * @param {number} width
 * @param {{closed?: boolean}} [options]
 */
export function drawTube(g, points, width, { closed = false } = {}) {
  if (points.length < 2) return;
  const trace = () => {
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) g.lineTo(points[i].x, points[i].y);
    if (closed) g.closePath();
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  trace();
  g.lineWidth = width + 3;
  g.strokeStyle = COLORS.tubeEdge;
  g.stroke();
  trace();
  g.lineWidth = width;
  g.strokeStyle = COLORS.tubeOuter;
  g.stroke();
  trace();
  g.lineWidth = width * 0.45;
  g.strokeStyle = COLORS.tubeInner;
  g.stroke();
  g.restore();
}

/**
 * Großer Countdown in der Mitte.
 * @param {CanvasRenderingContext2D} g
 */
export function drawCountdown(g, cx, cy, radius, value) {
  g.save();
  g.fillStyle = 'rgba(255, 255, 255, 0.88)';
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.text;
  g.font = `800 ${Math.round(radius * 1.2)}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(value), cx, cy + radius * 0.06);
  g.restore();
}

/**
 * Kurzer Hinweistext am unteren Rand.
 * @param {CanvasRenderingContext2D} g
 */
export function drawNotice(g, text, x, y, size = 16) {
  if (!text) return;
  g.save();
  g.font = `600 ${Math.round(size)}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillStyle = COLORS.textMuted;
  g.fillText(text, x, y);
  g.restore();
}
