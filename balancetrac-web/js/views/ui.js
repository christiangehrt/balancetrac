/**
 * ui.js – Kleine, wiederverwendbare DOM-Helfer für alle Views
 * (Element-Fabrik, Top-Bar, Segment-Auswahl, Schalter, Seitenmenü, Toast, Formatierung).
 */

import { getLanguage } from '../i18n.js';
import { uiIcon } from '../icons.js';

/**
 * Erzeugt ein DOM-Element.
 * Props: class, text, html (nur für interne, vertrauenswürdige SVG-Strings), on {event: handler},
 * dataset, style (Objekt) – alle übrigen Props werden als Attribute gesetzt.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    switch (key) {
      case 'class':
        el.className = value;
        break;
      case 'text':
        el.textContent = String(value);
        break;
      case 'html':
        el.innerHTML = value;
        break;
      case 'on':
        for (const [eventName, handler] of Object.entries(value)) el.addEventListener(eventName, handler);
        break;
      case 'dataset':
        Object.assign(el.dataset, value);
        break;
      case 'style':
        if (typeof value === 'object') Object.assign(el.style, value);
        else el.setAttribute('style', String(value));
        break;
      default:
        el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Setzt Text nur bei Änderung (vermeidet unnötige DOM-Arbeit in Render-Schleifen).
 * @param {Element} el
 * @param {string} text
 */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * Quadratischer Symbol-Button (≥ 56 px).
 * @param {{icon?: string, html?: string, label: string, onClick?: (e: Event) => void, className?: string, pressed?: boolean}} options
 */
export function iconButton({ icon, html, label, onClick, className = '', pressed }) {
  const btn = h('button', {
    type: 'button',
    class: ['icon-btn', className].filter(Boolean).join(' '),
    'aria-label': label,
    title: label,
    html: html ?? uiIcon(icon),
  });
  if (typeof pressed === 'boolean') btn.setAttribute('aria-pressed', String(pressed));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Vollbild-Button; das Symbol wechselt per CSS (body.is-fullscreen).
 * @param {string} label
 * @param {() => void} onClick
 */
export function fullscreenButton(label, onClick) {
  return iconButton({
    label,
    onClick,
    html: uiIcon('fullscreenEnter', 'icon-fs-enter') + uiIcon('fullscreenExit', 'icon-fs-exit'),
  });
}

/**
 * Top-Bar: links ≡, Mitte Titel (+ Untertitel), rechts Aktionen und optional "Go Back".
 * @param {{
 *   title: string, subtitle?: string, onMenu?: () => void, menuLabel?: string,
 *   actions?: HTMLElement[], back?: {label: string, onClick: () => void}
 * }} options
 */
export function createTopBar({ title, subtitle, onMenu, menuLabel = 'Menu', actions = [], back }) {
  const left = h(
    'div',
    { class: 'topbar-side topbar-left' },
    onMenu ? iconButton({ icon: 'menu', label: menuLabel, onClick: onMenu }) : null,
  );
  const center = h(
    'div',
    { class: 'topbar-center' },
    h('h1', { class: 'topbar-title', text: title }),
    subtitle ? h('div', { class: 'topbar-subtitle', text: subtitle }) : null,
  );
  const right = h(
    'div',
    { class: 'topbar-side topbar-right' },
    ...actions,
    back ? h('button', { type: 'button', class: 'btn btn-back', on: { click: back.onClick } }, back.label) : null,
  );
  return h('header', { class: 'topbar' }, left, center, right);
}

/**
 * Segment-Auswahl (z. B. "mode: Play | Train | Measure").
 * Buttons mit aria-pressed – Pfeiltasten bleiben frei für die Simulator-Steuerung.
 * @param {{label?: string, options: Array<{value: any, label: string}>, value: any, onChange?: (value: any) => void, className?: string}} options
 */
export function createSegmented({ label, options, value, onChange, className = '' }) {
  let current = value;
  const group = h('div', {
    class: ['segmented', className].filter(Boolean).join(' '),
    role: 'group',
    'aria-label': label ?? null,
  });
  if (label) group.append(h('span', { class: 'segmented-label', 'aria-hidden': 'true', text: label }));

  const buttons = options.map((option) => {
    const btn = h('button', { type: 'button', class: 'segmented-option' }, option.label);
    btn.addEventListener('click', () => {
      if (option.value === current) return;
      select(option.value);
      if (onChange) onChange(option.value);
    });
    group.append(btn);
    return btn;
  });

  function select(next) {
    current = next;
    buttons.forEach((btn, index) => btn.setAttribute('aria-pressed', String(options[index].value === next)));
  }

  select(current);
  return {
    el: group,
    get value() {
      return current;
    },
    set: select,
  };
}

/**
 * Ein/Aus-Schalter (Checkbox mit role="switch").
 * @param {{label: string, checked?: boolean, onChange?: (checked: boolean) => void}} options
 */
export function createToggle({ label, checked = false, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => {
    if (onChange) onChange(input.checked);
  });
  const el = h(
    'label',
    { class: 'toggle' },
    input,
    h('span', { class: 'toggle-track', 'aria-hidden': 'true' }),
    h('span', { class: 'toggle-label', text: label }),
  );
  return {
    el,
    set(next) {
      input.checked = Boolean(next);
    },
  };
}

/**
 * Öffnet das Seitenmenü. Schließen über ×, Hintergrund-Klick oder Escape.
 * @param {{title: string, closeLabel: string, items: Array<{icon: string, label: string, onClick: () => void}>, footer?: HTMLElement[]}} options
 * @returns {() => void} Funktion zum Schließen
 */
export function openDrawer({ title, closeLabel, items, footer = [] }) {
  const previouslyFocused = document.activeElement;
  let closed = false;

  const backdrop = h('div', { class: 'drawer-backdrop' });
  const list = h(
    'nav',
    { class: 'drawer-list' },
    items.map((item) => {
      const btn = h(
        'button',
        { type: 'button', class: 'drawer-item' },
        h('span', { class: 'drawer-item-icon', html: uiIcon(item.icon) }),
        h('span', { class: 'drawer-item-label', text: item.label }),
      );
      btn.addEventListener('click', () => {
        close();
        item.onClick();
      });
      return btn;
    }),
  );
  const panel = h(
    'aside',
    { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'drawer-head' },
      h('h2', { class: 'drawer-title', text: title }),
      iconButton({ icon: 'close', label: closeLabel, onClick: () => close() }),
    ),
    list,
    footer.length ? h('div', { class: 'drawer-footer' }, footer) : null,
  );

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      panel.remove();
      backdrop.remove();
    }, 220);
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
  }

  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => {
    panel.classList.add('open');
    backdrop.classList.add('open');
  });
  const firstItem = list.querySelector('button');
  if (firstItem) firstItem.focus();
  return close;
}

/**
 * Modaler Dialog mit frei wählbaren Aktionen. Escape oder Hintergrund-Klick = cancelValue.
 * @param {{
 *   title: string,
 *   message?: string,
 *   actions: Array<{label: string, value: any, variant?: 'primary'|'danger'|'default'}>,
 *   cancelValue?: any,
 * }} options
 * @returns {Promise<any>} value der gewählten Aktion
 */
export function openDialog({ title, message, actions, cancelValue = null }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const titleId = `dialog-title-${Date.now()}`;
    let done = false;

    const buttons = actions.map((action) => {
      const variant = action.variant === 'primary' ? 'btn-primary' : action.variant === 'danger' ? 'btn-danger' : '';
      const btn = h('button', { type: 'button', class: ['btn', variant].filter(Boolean).join(' ') }, action.label);
      btn.addEventListener('click', () => finish(action.value));
      return btn;
    });

    const backdrop = h(
      'div',
      { class: 'dialog-backdrop' },
      h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('h2', { class: 'dialog-title', id: titleId, text: title }),
        message ? h('p', { class: 'dialog-message', text: message }) : null,
        h('div', { class: 'dialog-actions' }, buttons),
      ),
    );

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(cancelValue);
      }
    }

    function finish(value) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
      resolve(value);
    }

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(cancelValue);
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.body.append(backdrop);
    const focusTarget = buttons.find((btn) => btn.classList.contains('btn-primary')) ?? buttons[0];
    if (focusTarget) focusTarget.focus();
  });
}

/**
 * Horizontaler Umschalter "< Wert >" (History-Filterleiste).
 * @param {{label: string, options: Array<{value: any, label: string}>, value: any, onChange: (value: any) => void, prevLabel: string, nextLabel: string}} options
 */
export function createStepper({ label, options, value, onChange, prevLabel, nextLabel }) {
  let index = Math.max(0, options.findIndex((option) => option.value === value));
  const valueEl = h('span', { class: 'stepper-value', 'aria-live': 'polite' });
  const prev = iconButton({ icon: 'chevronLeft', label: prevLabel, className: 'stepper-btn', onClick: () => step(-1) });
  const next = iconButton({ icon: 'chevronRight', label: nextLabel, className: 'stepper-btn', onClick: () => step(1) });
  const el = h(
    'div',
    { class: 'stepper', role: 'group', 'aria-label': label },
    prev,
    h('span', { class: 'stepper-body' }, h('span', { class: 'stepper-label', text: label }), valueEl),
    next,
  );

  function render() {
    valueEl.textContent = options[index]?.label ?? '';
    const single = options.length < 2;
    prev.disabled = single;
    next.disabled = single;
  }

  function step(delta) {
    if (options.length < 2) return;
    index = (index + delta + options.length) % options.length;
    render();
    onChange(options[index].value);
  }

  render();
  return {
    el,
    get value() {
      return options[index]?.value;
    },
  };
}

let toastTimer = 0;

/**
 * Kurze Statusmeldung oben in der Mitte.
 * @param {string} message
 * @param {number} [durationMs]
 */
export function showToast(message, durationMs = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // Reflow erzwingen, damit die Einblend-Transition neu startet
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, durationMs);
}

const numberFormats = new Map();

/**
 * Zahl im Format der App-Sprache (DE: Dezimalkomma, EN: Dezimalpunkt), ohne Tausendertrennzeichen.
 * @param {number} value
 * @param {number} [digits=0]  feste Anzahl Nachkommastellen
 */
export function formatNumber(value, digits = 0) {
  const v = Number.isFinite(value) ? value : 0;
  const locale = getLanguage() === 'de' ? 'de-DE' : 'en-GB';
  const key = `${locale}|${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    numberFormats.set(key, format);
  }
  return format.format(v);
}

/**
 * Zahl mit Vorzeichen und typografischem Minus (gut lesbar auf dem TV).
 * @param {number} value
 * @param {number} [digits]
 */
export function formatSigned(value, digits = 1) {
  const v = Number.isFinite(value) ? value : 0;
  const magnitude = Math.abs(v);
  if (Number(magnitude.toFixed(digits)) === 0) return formatNumber(0, digits);
  return `${v < 0 ? '−' : '+'}${formatNumber(magnitude, digits)}`;
}

/** @param {number} value */
export function formatDeg(value) {
  return `${formatSigned(value)}°`;
}

/**
 * Restzeit im Stil ":30" bzw. "1:00".
 * @param {number} seconds ganze Sekunden
 */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, '0');
  return minutes > 0 ? `${minutes}:${rest}` : `:${rest}`;
}

/**
 * true, wenn das Ziel eines Tastatur-Events ein Texteingabefeld ist.
 * @param {EventTarget | null} target
 */
export function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = /** @type {HTMLInputElement} */ (target).type;
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(type);
  }
  return false;
}
