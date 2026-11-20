/**
 * mazeData.js – 15 deterministische Labyrinth-Layouts (5 je Level) + Validator (DOM-frei).
 *
 * Jedes Layout entsteht aus einem festen Seed mit einem Tiefensuche-Generator ("recursive backtracker")
 * und ist damit bei jedem Start identisch. Ein Fingerabdruck-Test in tests/mazeData.test.js stellt
 * sicher, dass sich die Layouts nicht unbemerkt ändern.
 *
 * Koordinaten: 1 Einheit = 1 Zelle, x nach rechts, y nach unten (Bildschirm-Konvention).
 * Zell-Wände als Bitmaske: N = 1, E = 2, S = 4, W = 8.
 */

import { createRandom } from '../exercises.js';

export const WALL = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
export const WALL_THICKNESS = 0.14;
export const BALL_RADIUS = 0.24;
export const GOAL_RADIUS = 0.32;
export const HOLE_RADIUS = 0.3;
/** Par-Zeit = PAR_BASE_SEC + Länge des kürzesten Weges (Zellen) × Sekunden je Zelle. */
export const PAR_BASE_SEC = 5;
export const PAR_SEC_PER_CELL = Object.freeze({ 1: 2.2, 2: 2.0, 3: 2.0 });

const DIRECTIONS = Object.freeze([
  { bit: WALL.N, opposite: WALL.S, dx: 0, dy: -1 },
  { bit: WALL.E, opposite: WALL.W, dx: 1, dy: 0 },
  { bit: WALL.S, opposite: WALL.N, dx: 0, dy: 1 },
  { bit: WALL.W, opposite: WALL.E, dx: -1, dy: 0 },
]);

/** Feste Parameter der 15 Layouts – steigende Gangkomplexität, Level 3 mit Falllöchern. */
export const MAZE_SPECS = Object.freeze([
  Object.freeze({ id: 'L1-1', level: 1, index: 1, cols: 5, rows: 3, seed: 1101, holes: 0 }),
  Object.freeze({ id: 'L1-2', level: 1, index: 2, cols: 6, rows: 3, seed: 1102, holes: 0 }),
  Object.freeze({ id: 'L1-3', level: 1, index: 3, cols: 6, rows: 4, seed: 1103, holes: 0 }),
  Object.freeze({ id: 'L1-4', level: 1, index: 4, cols: 7, rows: 4, seed: 1104, holes: 0 }),
  Object.freeze({ id: 'L1-5', level: 1, index: 5, cols: 8, rows: 4, seed: 1105, holes: 0 }),
  Object.freeze({ id: 'L2-1', level: 2, index: 1, cols: 8, rows: 5, seed: 2201, holes: 0 }),
  Object.freeze({ id: 'L2-2', level: 2, index: 2, cols: 9, rows: 5, seed: 2202, holes: 0 }),
  Object.freeze({ id: 'L2-3', level: 2, index: 3, cols: 9, rows: 5, seed: 2203, holes: 0 }),
  Object.freeze({ id: 'L2-4', level: 2, index: 4, cols: 10, rows: 5, seed: 2204, holes: 0 }),
  Object.freeze({ id: 'L2-5', level: 2, index: 5, cols: 10, rows: 6, seed: 2205, holes: 0 }),
  Object.freeze({ id: 'L3-1', level: 3, index: 1, cols: 10, rows: 6, seed: 3301, holes: 2 }),
  Object.freeze({ id: 'L3-2', level: 3, index: 2, cols: 11, rows: 6, seed: 3302, holes: 3 }),
  Object.freeze({ id: 'L3-3', level: 3, index: 3, cols: 11, rows: 6, seed: 3303, holes: 3 }),
  Object.freeze({ id: 'L3-4', level: 3, index: 4, cols: 12, rows: 6, seed: 3304, holes: 4 }),
  Object.freeze({ id: 'L3-5', level: 3, index: 5, cols: 12, rows: 7, seed: 3305, holes: 5 }),
]);

const cellIndex = (cols, col, row) => row * cols + col;

/**
 * Darf man von (col, row) in Richtung dir gehen (keine Wand, innerhalb der Grenzen)?
 * @param {{cols: number, rows: number, cells: ArrayLike<number>}} maze
 */
export function canMove(maze, col, row, dir) {
  const d = DIRECTIONS.find((candidate) => candidate.bit === dir);
  if (!d) return false;
  const nc = col + d.dx;
  const nr = row + d.dy;
  if (nc < 0 || nr < 0 || nc >= maze.cols || nr >= maze.rows) return false;
  return (maze.cells[cellIndex(maze.cols, col, row)] & dir) === 0;
}

/**
 * Breitensuche über das Zellnetz.
 * @returns {{distance: number[], parent: number[]}}
 */
function bfs(maze, startIndex) {
  const total = maze.cols * maze.rows;
  const distance = new Array(total).fill(-1);
  const parent = new Array(total).fill(-1);
  const queue = [startIndex];
  distance[startIndex] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const col = current % maze.cols;
    const row = Math.floor(current / maze.cols);
    for (const d of DIRECTIONS) {
      if (!canMove(maze, col, row, d.bit)) continue;
      const next = cellIndex(maze.cols, col + d.dx, row + d.dy);
      if (distance[next] !== -1) continue;
      distance[next] = distance[current] + 1;
      parent[next] = current;
      queue.push(next);
    }
  }
  return { distance, parent };
}

/**
 * Kürzester Weg vom Start zum Ziel (inklusive beider Endzellen) oder [] wenn unerreichbar.
 * @param {{cols: number, rows: number, cells: ArrayLike<number>, start: {col: number, row: number}, goal: {col: number, row: number}}} maze
 * @returns {Array<{col: number, row: number}>}
 */
export function solveMaze(maze) {
  const start = cellIndex(maze.cols, maze.start.col, maze.start.row);
  const goal = cellIndex(maze.cols, maze.goal.col, maze.goal.row);
  const { distance, parent } = bfs(maze, start);
  if (distance[goal] < 0) return [];
  const path = [];
  for (let current = goal; current !== -1; current = parent[current]) {
    path.push({ col: current % maze.cols, row: Math.floor(current / maze.cols) });
  }
  return path.reverse();
}

/** Anzahl der vom Start erreichbaren Zellen. */
export function reachableCellCount(maze) {
  const { distance } = bfs(maze, cellIndex(maze.cols, maze.start.col, maze.start.row));
  return distance.filter((d) => d >= 0).length;
}

function carve(cols, rows, random) {
  const cells = new Array(cols * rows).fill(WALL.N | WALL.E | WALL.S | WALL.W);
  const visited = new Array(cols * rows).fill(false);
  const stack = [0];
  visited[0] = true;
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const col = current % cols;
    const row = Math.floor(current / cols);
    const options = [];
    for (const d of DIRECTIONS) {
      const nc = col + d.dx;
      const nr = row + d.dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = cellIndex(cols, nc, nr);
      if (!visited[next]) options.push({ d, next });
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const { d, next } = options[Math.floor(random() * options.length)];
    cells[current] &= ~d.bit;
    cells[next] &= ~d.opposite;
    visited[next] = true;
    stack.push(next);
  }
  return cells;
}

/**
 * Wandsegmente aus der Zell-Bitmaske; kollineare, aneinandergrenzende Stücke werden zusammengefasst,
 * damit die Kugel nicht an Nahtstellen hängen bleibt.
 */
export function wallSegments(maze) {
  const horizontal = new Map();
  const vertical = new Map();
  const add = (map, key, a, b) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push([a, b]);
  };
  for (let row = 0; row < maze.rows; row += 1) {
    for (let col = 0; col < maze.cols; col += 1) {
      const walls = maze.cells[cellIndex(maze.cols, col, row)];
      if (walls & WALL.N) add(horizontal, row, col, col + 1);
      if (walls & WALL.W) add(vertical, col, row, row + 1);
      if (row === maze.rows - 1 && walls & WALL.S) add(horizontal, row + 1, col, col + 1);
      if (col === maze.cols - 1 && walls & WALL.E) add(vertical, col + 1, row, row + 1);
    }
  }
  const merge = (pieces) => {
    const sorted = pieces.slice().sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const piece of sorted) {
      const last = merged[merged.length - 1];
      if (last && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
      else merged.push([piece[0], piece[1]]);
    }
    return merged;
  };
  const segments = [];
  for (const [y, pieces] of [...horizontal.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [x1, x2] of merge(pieces)) segments.push({ x1, y1: y, x2, y2: y });
  }
  for (const [x, pieces] of [...vertical.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [y1, y2] of merge(pieces)) segments.push({ x1: x, y1, x2: x, y2 });
  }
  return segments;
}

/** Kollisions-Rechtecke (Wandstärke WALL_THICKNESS) aus den Segmenten. */
export function segmentsToRects(segments, thickness = WALL_THICKNESS) {
  const half = thickness / 2;
  return segments.map((s) =>
    s.y1 === s.y2
      ? { x: s.x1 - half, y: s.y1 - half, w: s.x2 - s.x1 + thickness, h: thickness }
      : { x: s.x1 - half, y: s.y1 - half, w: thickness, h: s.y2 - s.y1 + thickness },
  );
}

function placeHoles(maze, solution, count, random) {
  if (count <= 0) return [];
  const onPath = new Set(solution.map((c) => cellIndex(maze.cols, c.col, c.row)));
  const start = cellIndex(maze.cols, maze.start.col, maze.start.row);
  const startNeighbours = new Set();
  for (const d of DIRECTIONS) {
    if (canMove(maze, maze.start.col, maze.start.row, d.bit)) {
      startNeighbours.add(cellIndex(maze.cols, maze.start.col + d.dx, maze.start.row + d.dy));
    }
  }
  const openings = (index) => DIRECTIONS.filter((d) => (maze.cells[index] & d.bit) === 0).length;
  const candidates = [];
  for (let index = 0; index < maze.cols * maze.rows; index += 1) {
    if (onPath.has(index) || index === start || startNeighbours.has(index)) continue;
    candidates.push(index);
  }
  // Sackgassen zuerst, innerhalb der Gruppen deterministisch gemischt
  const shuffled = candidates.map((index) => ({ index, key: random(), deadEnd: openings(index) === 1 }));
  shuffled.sort((a, b) => Number(b.deadEnd) - Number(a.deadEnd) || a.key - b.key);
  return shuffled.slice(0, count).map(({ index }) => ({ col: index % maze.cols, row: Math.floor(index / maze.cols) }));
}

/**
 * Baut ein Layout aus seiner Spezifikation.
 * @param {(typeof MAZE_SPECS)[number]} spec
 */
export function buildMaze(spec) {
  const random = createRandom(spec.seed);
  const cells = carve(spec.cols, spec.rows, random);
  const base = { cols: spec.cols, rows: spec.rows, cells, start: { col: 0, row: 0 }, goal: { col: 0, row: 0 } };

  // Ziel = vom Start am weitesten entfernte Zelle (längster Weg)
  const { distance } = bfs(base, 0);
  let goalIndex = 0;
  distance.forEach((d, index) => {
    if (d > distance[goalIndex] || (d === distance[goalIndex] && index > goalIndex)) goalIndex = index;
  });
  base.goal = { col: goalIndex % spec.cols, row: Math.floor(goalIndex / spec.cols) };

  const solution = solveMaze(base);
  const holes = placeHoles(base, solution, spec.holes, random);
  const segments = wallSegments(base);
  const pathLength = solution.length - 1;

  return Object.freeze({
    id: spec.id,
    level: spec.level,
    index: spec.index,
    cols: spec.cols,
    rows: spec.rows,
    cells: Object.freeze(cells),
    start: Object.freeze(base.start),
    goal: Object.freeze(base.goal),
    holes: Object.freeze(holes.map((hole) => Object.freeze(hole))),
    solution: Object.freeze(solution),
    pathLength,
    parSec: Math.round(PAR_BASE_SEC + pathLength * (PAR_SEC_PER_CELL[spec.level] ?? 2)),
    segments: Object.freeze(segments),
    wallRects: Object.freeze(segmentsToRects(segments).map((rect) => Object.freeze(rect))),
  });
}

/** Alle 15 Layouts. */
export const MAZES = Object.freeze(MAZE_SPECS.map(buildMaze));

/**
 * @param {number} level
 * @returns {ReadonlyArray<ReturnType<typeof buildMaze>>}
 */
export function getMazesForLevel(level) {
  return MAZES.filter((maze) => maze.level === level);
}

/** @param {string} id */
export function getMaze(id) {
  return MAZES.find((maze) => maze.id === id) ?? null;
}

/** Mittelpunkt einer Zelle in Weltkoordinaten. */
export function cellCenter(cell) {
  return { x: cell.col + 0.5, y: cell.row + 0.5 };
}

/** Kompakter Fingerabdruck eines Layouts (Wände, Start, Ziel, Löcher). */
export function mazeFingerprint(maze) {
  const walls = Array.from(maze.cells, (value) => value.toString(16)).join('');
  const holes = maze.holes.map((hole) => `${hole.col}.${hole.row}`).join(',');
  return `${maze.id}:${maze.cols}x${maze.rows}:${walls}:${maze.goal.col}.${maze.goal.row}:${holes}`;
}

/**
 * Prüft ein Layout auf Konsistenz und Lösbarkeit.
 * @param {object} maze
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMaze(maze) {
  const errors = [];
  const inBounds = (cell) =>
    cell && Number.isInteger(cell.col) && Number.isInteger(cell.row) && cell.col >= 0 && cell.row >= 0 && cell.col < maze.cols && cell.row < maze.rows;

  if (!maze || !Number.isInteger(maze.cols) || !Number.isInteger(maze.rows) || maze.cols < 2 || maze.rows < 2) {
    return { valid: false, errors: ['Ungültige Größe'] };
  }
  if (!maze.cells || maze.cells.length !== maze.cols * maze.rows) errors.push('Zellanzahl passt nicht zur Größe');
  else {
    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const walls = maze.cells[cellIndex(maze.cols, col, row)];
        if (!Number.isInteger(walls) || walls < 0 || walls > 15) errors.push(`Ungültige Wandmaske bei ${col}/${row}`);
        if (row === 0 && !(walls & WALL.N)) errors.push(`Außenwand oben fehlt bei ${col}`);
        if (row === maze.rows - 1 && !(walls & WALL.S)) errors.push(`Außenwand unten fehlt bei ${col}`);
        if (col === 0 && !(walls & WALL.W)) errors.push(`Außenwand links fehlt bei ${row}`);
        if (col === maze.cols - 1 && !(walls & WALL.E)) errors.push(`Außenwand rechts fehlt bei ${row}`);
        if (col < maze.cols - 1) {
          const right = maze.cells[cellIndex(maze.cols, col + 1, row)];
          if (Boolean(walls & WALL.E) !== Boolean(right & WALL.W)) errors.push(`Wand E/W inkonsistent bei ${col}/${row}`);
        }
        if (row < maze.rows - 1) {
          const below = maze.cells[cellIndex(maze.cols, col, row + 1)];
          if (Boolean(walls & WALL.S) !== Boolean(below & WALL.N)) errors.push(`Wand S/N inkonsistent bei ${col}/${row}`);
        }
      }
    }
  }
  if (!inBounds(maze.start)) errors.push('Start außerhalb');
  if (!inBounds(maze.goal)) errors.push('Ziel außerhalb');
  if (inBounds(maze.start) && inBounds(maze.goal) && maze.start.col === maze.goal.col && maze.start.row === maze.goal.row) {
    errors.push('Start und Ziel sind identisch');
  }
  if (errors.length === 0) {
    const solution = solveMaze(maze);
    if (solution.length === 0) errors.push('Ziel ist vom Start aus nicht erreichbar');
    const onPath = new Set(solution.map((c) => `${c.col}.${c.row}`));
    const seen = new Set();
    for (const hole of maze.holes ?? []) {
      const key = `${hole.col}.${hole.row}`;
      if (!inBounds(hole)) errors.push(`Loch außerhalb: ${key}`);
      else if (onPath.has(key)) errors.push(`Loch auf dem Lösungsweg: ${key}`);
      if (seen.has(key)) errors.push(`Loch doppelt: ${key}`);
      seen.add(key);
    }
  }
  for (const rect of maze.wallRects ?? []) {
    const t = WALL_THICKNESS;
    if (rect.x < -t || rect.y < -t || rect.x + rect.w > maze.cols + t || rect.y + rect.h > maze.rows + t) {
      errors.push('Wand außerhalb der Spielfläche');
      break;
    }
  }
  if (!(maze.parSec > 0)) errors.push('Par-Zeit fehlt');
  return { valid: errors.length === 0, errors };
}
