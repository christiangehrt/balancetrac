/**
 * audio.js – Sound-Synthese (Web Audio API) und Sprachansagen (speechSynthesis) für BalanceTrac.
 * Alle Effekte entstehen aus Oszillatoren bzw. Rauschen – keine Audiodateien.
 *
 * Der AudioContext muss auf iOS innerhalb einer Benutzer-Geste erzeugt bzw. fortgesetzt werden:
 * unlock() deshalb synchron aus einem Klick-Handler aufrufen (z. B. "Go!" oder eine Übungskachel).
 */

/** Namen der verfügbaren Sound-Effekte. */
export const SOUND_NAMES = Object.freeze(['tick', 'go', 'pause', 'finish', 'fanfare', 'catch', 'warning', 'laser', 'explosion', 'bump']);

/**
 * @param {{
 *   isSoundEnabled?: () => boolean,
 *   isVoiceEnabled?: () => boolean,
 *   getLanguage?: () => string,
 * }} [options]
 */
export function createAudioEngine({ isSoundEnabled = () => true, isVoiceEnabled = () => false, getLanguage = () => 'de' } = {}) {
  /** @type {AudioContext | null} */
  let context = null;
  /** @type {GainNode | null} */
  let master = null;
  /** @type {AudioBuffer | null} */
  let noiseBuffer = null;

  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;

  function ensureContext() {
    if (context || !AudioContextClass) return context;
    try {
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.55;
      master.connect(context.destination);
    } catch (error) {
      console.warn('[BalanceTrac] AudioContext nicht verfügbar:', error);
      context = null;
      master = null;
    }
    return context;
  }

  /** Erzeugt/aktiviert den AudioContext innerhalb einer Benutzer-Geste. */
  function unlock() {
    const ctx = ensureContext();
    if (!ctx) return null;
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      // Ein stummer Ein-Sample-Puffer entsperrt den Audio-Kanal auf iOS zuverlässig.
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (error) {
      console.warn('[BalanceTrac] AudioContext konnte nicht aktiviert werden:', error);
    }
    // iOS erlaubt Sprachausgabe erst nach einer Ansage aus einer Geste – eine leere Ansage genügt.
    const synth = globalThis.speechSynthesis;
    if (synth && isVoiceEnabled() && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        synth.speak(new SpeechSynthesisUtterance(''));
      } catch {
        // Sprachausgabe nicht verfügbar – Ansagen werden dann übersprungen.
      }
    }
    return ctx;
  }

  function canPlay() {
    return Boolean(isSoundEnabled() && context && master && context.state === 'running');
  }

  /**
   * Einzelner Ton mit kurzer Hüllkurve.
   * @param {{frequency: number, duration?: number, type?: OscillatorType, volume?: number, delay?: number, slideTo?: number}} options
   */
  function tone({ frequency, duration = 0.15, type = 'sine', volume = 0.3, delay = 0, slideTo }) {
    if (!canPlay()) return;
    const t0 = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t0);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(t0);
    oscillator.stop(t0 + duration + 0.05);
  }

  /**
   * Gefiltertes Rauschen (z. B. für Explosionen).
   * @param {{duration?: number, volume?: number, delay?: number, filterFrequency?: number}} options
   */
  function noise({ duration = 0.3, volume = 0.3, delay = 0, filterFrequency = 900 } = {}) {
    if (!canPlay()) return;
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 1), context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const t0 = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrequency, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFrequency / 6), t0 + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
    source.stop(t0 + duration + 0.05);
  }

  const sounds = {
    /** Countdown-Beep (3-2-1). */
    tick: () => tone({ frequency: 880, duration: 0.1, type: 'square', volume: 0.16 }),
    /** Start-Ton. */
    go: () => {
      tone({ frequency: 660, duration: 0.12, type: 'triangle', volume: 0.32 });
      tone({ frequency: 990, duration: 0.32, type: 'triangle', volume: 0.34, delay: 0.12 });
    },
    /** Pause-Ton (Train-Zirkel). */
    pause: () => tone({ frequency: 520, duration: 0.45, type: 'sine', volume: 0.3, slideTo: 330 }),
    /** Übung beendet. */
    finish: () => {
      [784, 988, 1175].forEach((frequency, index) =>
        tone({ frequency, duration: 0.18, type: 'triangle', volume: 0.3, delay: index * 0.12 }),
      );
    },
    /** Abschluss-Fanfare / neuer Bestwert. */
    fanfare: () => {
      [523.25, 659.25, 783.99].forEach((frequency, index) =>
        tone({ frequency, duration: 0.16, type: 'sawtooth', volume: 0.16, delay: index * 0.13 }),
      );
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency) =>
        tone({ frequency, duration: 0.9, type: 'triangle', volume: 0.14, delay: 0.42 }),
      );
    },
    /** Ziel gefangen (Tag). */
    catch: () => {
      tone({ frequency: 1320, duration: 0.09, type: 'sine', volume: 0.3 });
      tone({ frequency: 1760, duration: 0.16, type: 'sine', volume: 0.28, delay: 0.07 });
    },
    /** Warnung / Fehler. */
    warning: () => tone({ frequency: 180, duration: 0.3, type: 'sawtooth', volume: 0.2, slideTo: 120 }),
    /** Laser-Schuss (Play-Modul). */
    laser: () => tone({ frequency: 1400, duration: 0.12, type: 'square', volume: 0.12, slideTo: 300 }),
    /** Explosion (Play-Modul). */
    explosion: () => noise({ duration: 0.45, volume: 0.35, filterFrequency: 1400 }),
    /** Kugel prallt an eine Wand (Labyrinth). */
    bump: () => tone({ frequency: 150, duration: 0.07, type: 'triangle', volume: 0.18, slideTo: 90 }),
  };

  return {
    unlock,
    /**
     * Spielt einen benannten Effekt (siehe SOUND_NAMES). Ohne aktiven AudioContext oder bei
     * ausgeschaltetem Ton passiert nichts.
     * @param {string} name
     */
    play(name) {
      const sound = sounds[name];
      if (sound && canPlay()) sound();
    },
    tone,
    noise,
    /**
     * Sprachansage in der aktuellen App-Sprache (nur wenn Sprachausgabe eingeschaltet ist).
     * @param {string} text
     */
    speak(text) {
      const synth = globalThis.speechSynthesis;
      if (!text || !synth || !isVoiceEnabled() || typeof SpeechSynthesisUtterance === 'undefined') return;
      try {
        const language = getLanguage();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language === 'de' ? 'de-DE' : 'en-US';
        const voice = synth.getVoices().find((candidate) => candidate.lang?.toLowerCase().startsWith(language));
        if (voice) utterance.voice = voice;
        utterance.rate = 1;
        synth.cancel();
        synth.speak(utterance);
      } catch (error) {
        console.warn('[BalanceTrac] Sprachausgabe fehlgeschlagen:', error);
      }
    },
    getContext: () => context,
    isSupported: () => Boolean(AudioContextClass),
  };
}
