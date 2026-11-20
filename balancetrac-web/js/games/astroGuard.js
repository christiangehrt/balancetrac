/**
 * astroGuard.js – Spiel 2: "Astro Guard" (Weltraum-Abwehr, eigenes Design).
 *
 *  - Schwarzer Sternenhimmel, Angreifer-Formationen aus 3 prozeduralen Pixel-Art-Typen
 *  - 5 grüne Schutzschilde, die durch gegnerische Treffer und Angreifer blockweise erodieren
 *    (eigene Schüsse fliegen hindurch – ergonomisch für Auto-Fire)
 *  - Raumschiff per seitlicher Board-Neigung (Roll) steuern
 *  - Auto-Fire (Standard) oder Schuss durch leichtes Vorwärts-Kippen (Pitch)
 *  - Formation wandert seitwärts, rückt an den Rändern nach unten und feuert zurück;
 *    Tempo steigt mit jeder Welle, mit dem Level und mit jeder abgeschossenen Einheit
 *  - Spielende bei 0 Leben oder wenn die Angreifer landen
 *
 * Spiellogik ohne DOM (in Node testbar); Sprites werden erst beim Zeichnen erzeugt.
 */

import { createRandom } from '../exercises.js';
import { astroGuardScore } from '../scoring.js';
import { clamp, rectsOverlap } from './gameEngine.js';

export const ASTRO_GUARD_ACTIVITY_ID = 'ASTRO_GUARD';

/** Logische Spielwelt (16:9); oben ein Streifen für das HUD. */
export const WORLD = Object.freeze({ width: 200, height: 112, hud: 12 });

/** Pixel-Art: '#' = Grundfarbe, 'o' = Akzentfarbe, '.' = transparent. */
export const ALIEN_TYPES = Object.freeze({
  A: Object.freeze({
    points: 30,
    color: '#FF5C8A',
    accent: '#FFFFFF',
    frames: [
      ['...###...', '.#######.', '##.....##', '##..o..##', '##.....##', '.#######.', '#.#...#.#'],
      ['...###...', '.#######.', '##.....##', '##..o..##', '##.....##', '.#######.', '.#.#.#.#.'],
    ],
  }),
  B: Object.freeze({
    points: 20,
    color: '#FFB020',
    accent: '#3A1E00',
    frames: [
      ['#.........#', '##.......##', '###o###o###', '###########', '.###.#.###.', '...#####...', '....#.#....'],
      ['...........', '#.........#', '###o###o###', '###########', '####.#.####', '...#####...', '...#...#...'],
    ],
  }),
  C: Object.freeze({
    points: 10,
    color: '#36C2F2',
    accent: '#0B2A3A',
    frames: [
      ['..######..', '.########.', '##o####o##', '##########', '.#.#..#.#.', '.#.#..#.#.', '#..#..#..#', '...#..#...'],
      ['..######..', '.########.', '##o####o##', '##########', '.#.#..#.#.', '#..#..#..#', '#...##...#', '....##....'],
    ],
  }),
});

const PLAYER_SPRITE = ['......#......', '.....###.....', '.....#o#.....', '..#..###..#..', '.###.###.###.', '#############', '###.#####.###', '#...#...#...#'];

/** Formation, Grundtempo und Feuerrate je Level. */
export const LEVEL_SETUP = Object.freeze({
  1: Object.freeze({ rows: Object.freeze(['A', 'B', 'B', 'C']), cols: 8, speed: 9, fireInterval: 1.6 }),
  2: Object.freeze({ rows: Object.freeze(['A', 'B', 'B', 'C', 'C']), cols: 9, speed: 12, fireInterval: 1.2 }),
  3: Object.freeze({ rows: Object.freeze(['A', 'B', 'B', 'C', 'C']), cols: 10, speed: 15, fireInterval: 0.95 }),
});

export const ALIEN_SIZE = Object.freeze({ w: 11, h: 8, gapX: 4, gapY: 4 });
export const PLAYER = Object.freeze({ y: 101, w: 13, h: 8, speed: 120 });
const PLAYER_BULLET = Object.freeze({ w: 1.2, h: 5, speed: 160 });
const ALIEN_BULLET = Object.freeze({ w: 1.6, h: 4, speed: 55 });
export const FIRE = Object.freeze({ autoInterval: 0.42, pitchThreshold: 0.35, pitchCooldown: 0.3, maxPlayerBullets: 2 });
const SHIELD = Object.freeze({ count: 5, y: 84, block: 2.2, mask: Object.freeze(['..#####..', '.#######.', '#########', '#########', '#########']), hp: 2 });
const FORMATION_TOP = 16;
const STEP_DOWN = 4;
const EDGE = 4;
export const START_LIVES = 3;
const INVULNERABLE_SEC = 1.6;
const WAVE_SPEEDUP = 1.15;
const WAVE_BANNER_SEC = 1.6;
export const LANDING_Y = PLAYER.y - PLAYER.h / 2 - 2;

/**
 * @param {{level: number, fireMode?: 'auto'|'pitch', audio?: {play: (name: string) => void}, t?: Function, seed?: number}} options
 */
export function createAstroGuardGame({ level, fireMode = 'auto', audio = { play() {} }, t = (key) => key, seed = Date.now() }) {
  const setup = LEVEL_SETUP[level] ?? LEVEL_SETUP[1];
  const random = createRandom(seed);
  const stars = Array.from({ length: 140 }, () => ({
    x: random(),
    y: random(),
    size: random() < 0.15 ? 2 : 1,
    speed: 0.004 + random() * 0.018,
    twinkle: random() * Math.PI * 2,
  }));

  const player = { x: WORLD.width / 2, vx: 0 };
  let playerBullets = [];
  let alienBullets = [];
  let particles = [];
  let aliens = [];
  let shields = [];
  const formation = { x: 0, y: FORMATION_TOP, dir: 1 };
  let lives = START_LIVES;
  let points = 0;
  let wave = 1;
  let waveFactor = 1;
  let fireTimer = 0.3;
  let alienFireTimer = setup.fireInterval;
  let invulnerable = 0;
  let animationTime = 0;
  let elapsed = 0;
  let state = 'wave'; // wave (Banner, Formation wartet) | playing | over
  let bannerTimer = WAVE_BANNER_SEC;
  let overReason = null;
  let total = setup.rows.length * setup.cols;

  // ---- Aufbau ---------------------------------------------------------------------------
  function formationWidth() {
    return setup.cols * ALIEN_SIZE.w + (setup.cols - 1) * ALIEN_SIZE.gapX;
  }

  function spawnWave() {
    aliens = [];
    setup.rows.forEach((type, row) => {
      for (let col = 0; col < setup.cols; col += 1) aliens.push({ type, row, col, alive: true });
    });
    total = aliens.length;
    formation.x = (WORLD.width - formationWidth()) / 2;
    formation.y = FORMATION_TOP + Math.min(wave - 1, 4) * 3;
    formation.dir = 1;
    alienBullets = [];
  }

  function buildShields() {
    shields = [];
    const width = SHIELD.mask[0].length * SHIELD.block;
    for (let i = 0; i < SHIELD.count; i += 1) {
      const left = (WORLD.width * (i + 0.5)) / SHIELD.count - width / 2;
      const blocks = [];
      SHIELD.mask.forEach((line, row) => {
        [...line].forEach((char, col) => {
          if (char === '#') blocks.push({ x: left + col * SHIELD.block, y: SHIELD.y + row * SHIELD.block, w: SHIELD.block, h: SHIELD.block, hp: SHIELD.hp });
        });
      });
      shields.push(blocks);
    }
  }

  spawnWave();
  buildShields();

  const alienRect = (alien) => ({
    x: formation.x + alien.col * (ALIEN_SIZE.w + ALIEN_SIZE.gapX),
    y: formation.y + alien.row * (ALIEN_SIZE.h + ALIEN_SIZE.gapY),
    w: ALIEN_SIZE.w,
    h: ALIEN_SIZE.h,
  });
  const playerRect = () => ({ x: player.x - PLAYER.w / 2, y: PLAYER.y - PLAYER.h / 2, w: PLAYER.w, h: PLAYER.h });

  function aliveCount() {
    let count = 0;
    for (const alien of aliens) if (alien.alive) count += 1;
    return count;
  }

  function formationSpeed() {
    const remaining = aliveCount() / Math.max(1, total);
    return setup.speed * waveFactor * (1 + 1.6 * (1 - remaining));
  }

  function explode(x, y, color, count = 14, power = 40) {
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = power * (0.3 + random() * 0.9);
      const life = 0.35 + random() * 0.45;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color, size: 0.8 + random() * 1.4 });
    }
  }

  function firePlayer() {
    playerBullets.push({ x: player.x - PLAYER_BULLET.w / 2, y: PLAYER.y - PLAYER.h / 2 - PLAYER_BULLET.h, w: PLAYER_BULLET.w, h: PLAYER_BULLET.h });
    audio.play('laser');
  }

  function hitShield(bullet) {
    for (const blocks of shields) {
      for (const block of blocks) {
        if (block.hp > 0 && rectsOverlap(bullet, block)) {
          block.hp -= 1;
          explode(block.x + block.w / 2, block.y + block.h / 2, '#3DDC84', 4, 18);
          return true;
        }
      }
    }
    return false;
  }

  function gameOver(reason) {
    if (state === 'over') return;
    state = 'over';
    overReason = reason;
    explode(player.x, PLAYER.y, '#E8F7FF', 26, 55);
    audio.play('finish');
  }

  // ---- Update ---------------------------------------------------------------------------
  function update(dt, input) {
    animationTime += dt;
    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.96;
      particle.vy *= 0.96;
      particle.life -= dt;
    }
    particles = particles.filter((particle) => particle.life > 0);
    if (state === 'over') return;
    elapsed += dt;

    // Raumschiff: seitliche Neigung steuert die Zielgeschwindigkeit, weich nachgeführt
    const ix = Number.isFinite(input?.x) ? clamp(input.x, -1, 1) : 0;
    const iy = Number.isFinite(input?.y) ? clamp(input.y, -1, 1) : 0;
    player.vx += (ix * PLAYER.speed - player.vx) * Math.min(1, dt * 12);
    player.x = clamp(player.x + player.vx * dt, PLAYER.w / 2 + 2, WORLD.width - PLAYER.w / 2 - 2);
    invulnerable = Math.max(0, invulnerable - dt);

    // Schüsse: Auto-Fire oder Vorwärts-Kippen
    fireTimer -= dt;
    if (fireTimer <= 0 && playerBullets.length < FIRE.maxPlayerBullets) {
      if (fireMode === 'pitch') {
        if (iy > FIRE.pitchThreshold) {
          firePlayer();
          fireTimer = FIRE.pitchCooldown;
        }
      } else {
        firePlayer();
        fireTimer = FIRE.autoInterval;
      }
    }

    if (state === 'wave') {
      bannerTimer -= dt;
      if (bannerTimer <= 0) state = 'playing';
    }

    // Formation
    if (state === 'playing') {
      formation.x += formation.dir * formationSpeed() * dt;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const alien of aliens) {
        if (!alien.alive) continue;
        const rect = alienRect(alien);
        minX = Math.min(minX, rect.x);
        maxX = Math.max(maxX, rect.x + rect.w);
      }
      if ((formation.dir > 0 && maxX >= WORLD.width - EDGE) || (formation.dir < 0 && minX <= EDGE)) {
        formation.x -= formation.dir > 0 ? maxX - (WORLD.width - EDGE) : minX - EDGE;
        formation.dir *= -1;
        formation.y += STEP_DOWN;
      }

      alienFireTimer -= dt;
      if (alienFireTimer <= 0) {
        const shooters = new Map();
        for (const alien of aliens) {
          if (!alien.alive) continue;
          const current = shooters.get(alien.col);
          if (!current || alien.row > current.row) shooters.set(alien.col, alien);
        }
        const candidates = [...shooters.values()];
        if (candidates.length > 0) {
          const shooter = candidates[Math.floor(random() * candidates.length)];
          const rect = alienRect(shooter);
          alienBullets.push({ x: rect.x + rect.w / 2 - ALIEN_BULLET.w / 2, y: rect.y + rect.h, w: ALIEN_BULLET.w, h: ALIEN_BULLET.h });
        }
        alienFireTimer = (setup.fireInterval / (1 + 0.15 * (wave - 1))) * (0.6 + random() * 0.8);
      }
    }

    // Geschosse bewegen
    for (const bullet of playerBullets) bullet.y -= PLAYER_BULLET.speed * dt;
    for (const bullet of alienBullets) bullet.y += ALIEN_BULLET.speed * dt;
    playerBullets = playerBullets.filter((bullet) => bullet.y + bullet.h > WORLD.hud);
    alienBullets = alienBullets.filter((bullet) => bullet.y < WORLD.height);

    // Spieler-Schüsse gegen Angreifer und gegnerische Schüsse. Eigene Schüsse fliegen durch die
    // Schilde – sonst würde Auto-Fire den Schild über dem Schiff selbst zerstören.
    playerBullets = playerBullets.filter((bullet) => {
      for (const alien of aliens) {
        if (!alien.alive) continue;
        const rect = alienRect(alien);
        if (rectsOverlap(bullet, rect)) {
          alien.alive = false;
          const type = ALIEN_TYPES[alien.type];
          points += type.points;
          explode(rect.x + rect.w / 2, rect.y + rect.h / 2, type.color);
          audio.play('explosion');
          return false;
        }
      }
      const index = alienBullets.findIndex((other) => rectsOverlap(bullet, other));
      if (index >= 0) {
        alienBullets.splice(index, 1);
        explode(bullet.x, bullet.y, '#FFFFFF', 5, 20);
        return false;
      }
      return true;
    });

    // Gegnerische Schüsse gegen Schilde und Spieler
    alienBullets = alienBullets.filter((bullet) => {
      if (hitShield(bullet)) return false;
      if (rectsOverlap(bullet, playerRect())) {
        if (invulnerable === 0) {
          lives -= 1;
          invulnerable = INVULNERABLE_SEC;
          explode(player.x, PLAYER.y, '#E8F7FF', 18, 45);
          audio.play('warning');
          if (lives <= 0) gameOver('lives');
        }
        return false;
      }
      return true;
    });

    // Angreifer zerstören berührte Schildblöcke; Landung beendet das Spiel
    for (const alien of aliens) {
      if (!alien.alive) continue;
      const rect = alienRect(alien);
      for (const blocks of shields) {
        for (const block of blocks) if (block.hp > 0 && rectsOverlap(rect, block)) block.hp = 0;
      }
      if (rect.y + rect.h >= LANDING_Y) gameOver('landed');
    }
    if (state === 'over') return;

    // Welle geschafft
    if (aliveCount() === 0) {
      wave += 1;
      waveFactor *= WAVE_SPEEDUP;
      spawnWave();
      state = 'wave';
      bannerTimer = WAVE_BANNER_SEC;
      audio.play('go');
    }
  }

  // ---- Rendering ------------------------------------------------------------------------
  const spriteCache = new Map();
  let cachedScale = 0;

  function sprite(key, bitmap, color, accent, pixel) {
    const cacheKey = `${key}:${pixel.toFixed(3)}`;
    let canvas = spriteCache.get(cacheKey);
    if (!canvas) {
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
      const cols = bitmap[0].length;
      const rows = bitmap.length;
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(cols * pixel * dpr));
      canvas.height = Math.max(1, Math.ceil(rows * pixel * dpr));
      const g = canvas.getContext('2d');
      const p = pixel * dpr;
      bitmap.forEach((line, row) => {
        [...line].forEach((char, col) => {
          if (char === '.') return;
          g.fillStyle = char === 'o' ? accent : color;
          g.fillRect(Math.floor(col * p), Math.floor(row * p), Math.ceil(p), Math.ceil(p));
        });
      });
      spriteCache.set(cacheKey, canvas);
    }
    return canvas;
  }

  function render(g, width, height, view) {
    const time = view?.time ?? animationTime;
    const scale = Math.min(width / WORLD.width, height / WORLD.height);
    if (scale !== cachedScale) {
      spriteCache.clear();
      cachedScale = scale;
    }
    const ox = (width - WORLD.width * scale) / 2;
    const oy = (height - WORLD.height * scale) / 2;
    const X = (x) => ox + x * scale;
    const Y = (y) => oy + y * scale;

    g.fillStyle = '#000000';
    g.fillRect(0, 0, width, height);

    // Sternenhimmel (driftet langsam, funkelt)
    for (const star of stars) {
      const y = (star.y + time * star.speed) % 1;
      const alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2 + star.twinkle));
      g.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
      g.fillRect(star.x * width, y * height, star.size, star.size);
    }

    // Schilde
    for (const blocks of shields) {
      for (const block of blocks) {
        if (block.hp <= 0) continue;
        g.fillStyle = block.hp >= SHIELD.hp ? '#3DDC84' : '#22894F';
        g.fillRect(X(block.x), Y(block.y), Math.ceil(block.w * scale), Math.ceil(block.h * scale));
      }
    }

    // Angreifer
    const frame = Math.floor(animationTime / 0.45) % 2;
    for (const alien of aliens) {
      if (!alien.alive) continue;
      const type = ALIEN_TYPES[alien.type];
      const bitmap = type.frames[frame];
      const pixel = Math.min(ALIEN_SIZE.w / bitmap[0].length, ALIEN_SIZE.h / bitmap.length) * scale;
      const image = sprite(`${alien.type}${frame}`, bitmap, type.color, type.accent, pixel);
      const rect = alienRect(alien);
      const drawW = bitmap[0].length * pixel;
      const drawH = bitmap.length * pixel;
      g.drawImage(image, X(rect.x) + (rect.w * scale - drawW) / 2, Y(rect.y) + (rect.h * scale - drawH) / 2, drawW, drawH);
    }

    // Raumschiff (blinkt nach einem Treffer)
    if (state !== 'over' && (invulnerable === 0 || Math.floor(invulnerable * 10) % 2 === 0)) {
      const pixel = (PLAYER.w / PLAYER_SPRITE[0].length) * scale;
      const image = sprite('player', PLAYER_SPRITE, '#E8F7FF', '#36C2F2', pixel);
      g.drawImage(image, X(player.x - PLAYER.w / 2), Y(PLAYER.y - PLAYER.h / 2), PLAYER.w * scale, PLAYER.h * scale);
    }

    // Laser & gegnerische Schüsse
    for (const bullet of playerBullets) {
      g.fillStyle = 'rgba(54, 194, 242, 0.35)';
      g.fillRect(X(bullet.x - bullet.w), Y(bullet.y), bullet.w * 3 * scale, bullet.h * scale);
      g.fillStyle = '#CFF4FF';
      g.fillRect(X(bullet.x), Y(bullet.y), Math.max(1.5, bullet.w * scale), bullet.h * scale);
    }
    for (const bullet of alienBullets) {
      const wiggle = Math.sin((time + bullet.x) * 25) * bullet.w * 0.4 * scale;
      g.fillStyle = '#FF7A3D';
      g.fillRect(X(bullet.x) + wiggle, Y(bullet.y), Math.max(1.5, bullet.w * scale), bullet.h * scale);
    }

    // Partikel
    for (const particle of particles) {
      g.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      g.fillStyle = particle.color;
      const size = particle.size * scale;
      g.fillRect(X(particle.x) - size / 2, Y(particle.y) - size / 2, size, size);
    }
    g.globalAlpha = 1;

    // HUD
    const hudHeight = WORLD.hud * scale;
    const big = Math.round(clamp(hudHeight * 0.75, 22, 48));
    const small = Math.round(clamp(hudHeight * 0.36, 12, 22));
    const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#FFFFFF';
    g.font = `800 ${big}px ${font}`;
    const pointsText = String(points);
    g.fillText(pointsText, X(4), Y(WORLD.hud / 2));
    const pointsWidth = g.measureText(pointsText).width;
    g.font = `600 ${small}px ${font}`;
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.fillText(t('play.astro.wave', { wave }), X(4) + pointsWidth + small * 0.8, Y(WORLD.hud / 2));

    const lifePixel = (PLAYER.w / PLAYER_SPRITE[0].length) * scale * 0.55;
    const lifeImage = sprite('life', PLAYER_SPRITE, '#E8F7FF', '#36C2F2', lifePixel);
    const lifeW = PLAYER_SPRITE[0].length * lifePixel;
    const lifeH = PLAYER_SPRITE.length * lifePixel;
    g.textAlign = 'right';
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.fillText(`L${level}`, X(WORLD.width - 4), Y(WORLD.hud / 2));
    const levelWidth = g.measureText(`L${level}`).width;
    for (let i = 0; i < lives; i += 1) {
      const x = X(WORLD.width - 4) - levelWidth - small * 0.8 - (i + 1) * (lifeW + 4);
      g.drawImage(lifeImage, x, Y(WORLD.hud / 2) - lifeH / 2, lifeW, lifeH);
    }

    // Banner
    if (state === 'wave' || state === 'over') {
      const title = state === 'over' ? t('play.astro.gameOver') : t('play.astro.wave', { wave });
      const subtitle = state === 'over' && overReason === 'landed' ? t('play.astro.landed') : '';
      g.textAlign = 'center';
      g.fillStyle = state === 'over' ? '#FF5C8A' : '#FFFFFF';
      g.font = `800 ${Math.round(big * 1.4)}px ${font}`;
      g.fillText(title, width / 2, Y(WORLD.height * 0.55));
      if (subtitle) {
        g.font = `600 ${small}px ${font}`;
        g.fillStyle = 'rgba(255, 255, 255, 0.85)';
        g.fillText(subtitle, width / 2, Y(WORLD.height * 0.55) + big);
      }
    }
  }

  return {
    id: ASTRO_GUARD_ACTIVITY_ID,
    resize() {
      spriteCache.clear();
      cachedScale = 0;
    },
    update,
    render,
    isFinished: () => state === 'over',
    getResult() {
      return {
        activityId: ASTRO_GUARD_ACTIVITY_ID,
        durationSec: Math.round(elapsed * 10) / 10,
        rawValue: points,
        score: astroGuardScore(points, level),
        wave,
        overReason,
      };
    },
    /** Testzugriff auf den Zustand. */
    debug: {
      get state() {
        return state;
      },
      get points() {
        return points;
      },
      get lives() {
        return lives;
      },
      get wave() {
        return wave;
      },
      get formation() {
        return { ...formation };
      },
      get aliens() {
        return aliens.map((alien) => ({ ...alien, rect: alienRect(alien) }));
      },
      get player() {
        return { ...player };
      },
      get playerBullets() {
        return playerBullets.map((bullet) => ({ ...bullet }));
      },
      get shieldBlocks() {
        return shields.reduce((sum, blocks) => sum + blocks.filter((block) => block.hp > 0).length, 0);
      },
      /** Setzt die Formation (nur für Tests). */
      setFormationY(y) {
        formation.y = y;
      },
      killAllAliens() {
        for (const alien of aliens) alien.alive = false;
      },
      skipBanner() {
        bannerTimer = 0;
        state = state === 'wave' ? 'playing' : state;
      },
    },
  };
}
