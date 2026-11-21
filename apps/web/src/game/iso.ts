import Phaser from 'phaser';

// ---------- grid & projection (2:1 isometric, 64x32 tiles) ----------
export const GW = 38, GH = 30;
export const TW = 64, TH = 32;
export const OX = GH * 32, OY = 60;
export const WORLD_W = (GW + GH) * 32, WORLD_H = (GW + GH) * 16 + 140;
/** grid (continuous, tile centre = n+0.5) -> screen/world pixels */
export const proj = (gx: number, gy: number) => ({ x: (gx - gy) * (TW / 2) + OX, y: (gx + gy) * (TH / 2) + OY });
export const unproj = (x: number, y: number) => { const a = (x - OX) / (TW / 2), b = (y - OY) / (TH / 2); return { gx: (a + b) / 2, gy: (b - a) / 2 }; };
export const depthOf = (gx: number, gy: number, z = 0) => (gx + gy) * 100 + z;

export type Kind = 'grass' | 'path' | 'hall' | 'er' | 'op' | 'ip' | 'admin' | 'corr' | 'door' | 'wall' | 'tree' | 'hedge' | 'fountain';
export interface Tile { kind: Kind; wall?: 'hi' | 'mid' | 'lo'; floor?: Kind; blocked?: boolean }
export const WALL_H = { hi: 58, mid: 22, lo: 12 } as const;

export interface Room { id: string; x0: number; y0: number; x1: number; y1: number; label: string }
export const ROOMS: Record<string, Room> = {
  er: { id: 'er', x0: 5, y0: 5, x1: 16, y1: 11, label: 'EMERGENCY DEPT' },
  ip: { id: 'ip', x0: 18, y0: 5, x1: 32, y1: 11, label: 'INPATIENT WARD' },
  corr: { id: 'corr', x0: 5, y0: 13, x1: 32, y1: 15, label: 'MAIN CORRIDOR' },
  hall: { id: 'hall', x0: 5, y0: 17, x1: 12, y1: 23, label: 'RECEPTION / WAITING' },
  admin: { id: 'admin', x0: 14, y0: 17, x1: 18, y1: 23, label: 'ADMIN OFFICE' },
  op: { id: 'op', x0: 20, y0: 17, x1: 32, y1: 23, label: 'OUTPATIENT CLINIC' },
};
export const ENTRANCE = { x: 8, y: 24 };     // door tile in the south wall
export const SPAWN = { x: 8, y: 28 };        // outside, south of the entrance
export const DOORS: Record<string, { x: number; y: number }> = {
  er: { x: 10, y: 12 }, ip: { x: 24, y: 12 }, hall: { x: 9, y: 16 }, admin: { x: 16, y: 16 }, op: { x: 26, y: 16 }, entrance: ENTRANCE,
};
export type Dept = 'emergency' | 'outpatient' | 'inpatient';

/** bed/room slot i of a department -> tile */
export const bedTile = (svc: Dept, i: number) => {
  const c = i % 6, r = Math.floor(i / 6);
  if (svc === 'emergency') return { x: 6 + 2 * c, y: 6 + 2 * r };
  if (svc === 'inpatient') return { x: 19 + 2 * c, y: 6 + 2 * r };
  return { x: 21 + 2 * c, y: 18 + 2 * r };
};
/** waiting spots in the corridor in front of each department door, nearest the door first */
export const queueSpots = (svc: Dept) => {
  const door = svc === 'emergency' ? DOORS.er : svc === 'inpatient' ? DOORS.ip : DOORS.op;
  const row = svc === 'outpatient' ? 15 : 13;
  const lo = svc === 'emergency' ? 6 : svc === 'inpatient' ? 20 : 22, hi = svc === 'emergency' ? 14 : svc === 'inpatient' ? 28 : 30;
  const xs: number[] = []; for (let x = lo; x <= hi; x++) xs.push(x);
  xs.sort((a, b) => Math.abs(a - door.x) - Math.abs(b - door.x) || a - b);
  return xs.map((x) => ({ x, y: row }));
};
export const INTERACT = [
  { x: 16, y: 21, tab: 'manage', label: 'Admin desk: manage hospital' },
  { x: 6, y: 21, tab: 'data', label: 'Reception board: why these patients?' },
  { x: 13, y: 10, tab: 'manage', label: 'ER console: staffing & rooms' },
  { x: 23, y: 10, tab: 'manage', label: 'Ward console: beds & staffing' },
  { x: 25, y: 18, tab: 'manage', label: 'Clinic console: staffing & rooms' },
  { x: 30, y: 14, tab: 'about', label: 'Info kiosk: data & assumptions' },
];

export type Prop = { x: number; y: number; tex: string; dy?: number; blocked?: boolean };

// ---------- map construction ----------
export function buildMap(): { tiles: Tile[][]; props: Prop[] } {
  const tiles: Tile[][] = Array.from({ length: GH }, () => Array.from({ length: GW }, () => ({ kind: 'grass' as Kind })));
  const set = (x: number, y: number, t: Tile) => { if (x >= 0 && y >= 0 && x < GW && y < GH) tiles[y][x] = t; };
  const rect = (r: Room, kind: Kind) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, { kind }); };
  // building shell: walls on the boundary
  for (let y = 4; y <= 24; y++) for (let x = 4; x <= 33; x++) {
    if (x === 4 || y === 4) set(x, y, { kind: 'wall', wall: 'hi' });
    else if (x === 33 || y === 24) set(x, y, { kind: 'wall', wall: 'lo' });
    else set(x, y, { kind: 'wall', wall: 'mid' });
  }
  rect(ROOMS.er, 'er'); rect(ROOMS.ip, 'ip'); rect(ROOMS.corr, 'corr'); rect(ROOMS.hall, 'hall'); rect(ROOMS.admin, 'admin'); rect(ROOMS.op, 'op');
  for (const d of Object.values(DOORS)) set(d.x, d.y, { kind: 'door' });
  // garden: paths
  for (let y = 25; y < GH; y++) set(8, y, { kind: 'path' });
  for (let x = 3; x <= 24; x++) set(x, 27, { kind: 'path' });
  for (let y = 25; y < GH; y++) set(24, y, { kind: 'path' });
  for (let y = 5; y <= 26; y++) set(2, y, { kind: 'path' });
  const props: Prop[] = []; const P = (x: number, y: number, tex: string, blocked = false, dy = 0) => { props.push({ x, y, tex, blocked, dy }); if (blocked) tiles[y][x].blocked = true; };
  // trees & hedges & fountain (garden)
  [[0, 0], [2, 2], [0, 6], [0, 12], [0, 18], [0, 24], [0, 28], [3, 29], [12, 29], [17, 29], [20, 25], [28, 27], [31, 29], [36, 28], [35, 24], [36, 18], [35, 12], [36, 6], [35, 1], [30, 1], [24, 1], [18, 2], [11, 0], [6, 1], [14, 26], [4, 25], [28, 25], [35, 27]].forEach(([x, y]) => { if (tiles[y][x].kind === 'grass') P(x, y, 'tree', true); });
  for (let x = 5; x <= 7; x++) { if (tiles[26][x].kind === 'grass') P(x, 26, 'hedge', true); }
  for (let x = 9; x <= 11; x++) { if (tiles[26][x].kind === 'grass') P(x, 26, 'hedge', true); }
  for (let y = 25; y <= 26; y++) { P(13, y + 1, 'hedge', true); }
  tiles[28][16].kind === 'grass' && P(16, 28, 'fountain', true);
  [[26, 26], [27, 28], [30, 26], [3, 22], [3, 8], [34, 20], [34, 8], [22, 28], [26, 29]].forEach(([x, y]) => { if (tiles[y][x].kind === 'grass') P(x, y, 'flowers'); });
  // reception hall
  P(5, 19, 'counter', true); P(6, 19, 'counter', true); P(7, 19, 'counter', true); P(6, 21, 'board'); P(5, 21, 'plant');
  [[11, 18], [11, 20], [11, 22], [12, 18]].forEach(([x, y]) => P(x, y, 'bench', true));
  P(5, 23, 'plant'); P(12, 23, 'plant');
  // admin office
  P(16, 21, 'desk', true); P(17, 21, 'desk', true); P(16, 21, 'monitor', false, -12); P(15, 18, 'cabinet', true); P(17, 18, 'cabinet', true); P(18, 23, 'plant'); P(14, 23, 'plant');
  // ER / ward / clinic equipment & decor
  P(13, 10, 'console', true); P(6, 5, 'cabinet', true); P(7, 5, 'cabinet', true); P(16, 5, 'plant'); P(16, 11, 'plant');
  P(23, 10, 'console', true); P(18, 5, 'plant'); P(32, 5, 'plant'); P(32, 11, 'plant'); P(20, 5, 'cabinet', true);
  P(25, 18, 'console', true); P(32, 17, 'plant'); P(20, 17, 'cabinet', true); P(32, 23, 'plant'); P(21, 23, 'plant');
  P(5, 15, 'plant'); P(18, 15, 'plant'); P(32, 13, 'plant'); P(30, 14, 'kiosk', true); P(20, 13, 'vending', true);
  return { tiles, props };
}

export function walkable(tiles: Tile[][], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GW || y >= GH) return false;
  const t = tiles[y][x]; return t.kind !== 'wall' && t.kind !== 'tree' && t.kind !== 'hedge' && t.kind !== 'fountain' && !t.blocked;
}
/** BFS (4-neighbour) path of tile coordinates from a to b; goal may itself be a blocked tile (e.g. a bed/console) */
export function findPath(tiles: Tile[][], a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const key = (x: number, y: number) => y * GW + x; const prev = new Map<number, number>(); const q: number[] = [key(a.x, a.y)]; prev.set(q[0], -1);
  const goal = key(b.x, b.y);
  for (let i = 0; i < q.length; i++) {
    const c = q[i]; if (c === goal) break; const cx = c % GW, cy = Math.floor(c / GW);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || prev.has(k)) continue;
      if (!(walkable(tiles, nx, ny) || k === goal)) continue;
      prev.set(k, c); q.push(k);
    }
  }
  if (!prev.has(goal)) return [];
  const out: { x: number; y: number }[] = []; for (let c = goal; c !== -1 && c !== key(a.x, a.y); c = prev.get(c)!) out.push({ x: c % GW, y: Math.floor(c / GW) });
  return out.reverse();
}

// ---------- procedural pixel-art textures ----------
const diamond = (g: Phaser.GameObjects.Graphics, cx: number, cy: number, f: number, color: number) =>
  g.fillStyle(color).fillPoints([{ x: cx, y: cy - 16 * f }, { x: cx + 32 * f, y: cy }, { x: cx, y: cy + 16 * f }, { x: cx - 32 * f, y: cy }], true);
function box(g: Phaser.GameObjects.Graphics, key: string, f: number, h: number, top: number, left: number, right: number, extra?: (g: Phaser.GameObjects.Graphics) => void) {
  g.clear(); const cy = 16;
  g.fillStyle(left).fillPoints([{ x: 32 - 32 * f, y: cy }, { x: 32, y: cy + 16 * f }, { x: 32, y: cy + 16 * f + h }, { x: 32 - 32 * f, y: cy + h }], true);
  g.fillStyle(right).fillPoints([{ x: 32 + 32 * f, y: cy }, { x: 32, y: cy + 16 * f }, { x: 32, y: cy + 16 * f + h }, { x: 32 + 32 * f, y: cy + h }], true);
  diamond(g, 32, cy, f, top); extra?.(g); g.generateTexture(key, 64, 32 + h);
}
export const boxOrigin = (h: number) => (16 + h) / (32 + h);

export function makeTextures(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const floor = (k: string, a: number, b: number) => { [a, b].forEach((c, i) => { g.clear(); diamond(g, 32, 16, 1, c); g.lineStyle(1, 0x000000, 0.06).strokePoints([{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }], true); g.generateTexture(`f_${k}_${i}`, 64, 32); }); };
  floor('grass', 0x58a85a, 0x4f9f52); floor('path', 0xd2c3a3, 0xc9b99a); floor('hall', 0xcfe3ea, 0xc3d9e2); floor('er', 0xd7f0e5, 0xcdeadc);
  floor('op', 0xdbe8f9, 0xd1e0f4); floor('ip', 0xe6dcf5, 0xdccff0); floor('admin', 0xe9dcc3, 0xe2d4b8); floor('corr', 0xe8eef5, 0xdfe7f1); floor('door', 0xb08968, 0xa57c5c);
  (['hi', 'mid', 'lo'] as const).forEach((k) => {
    const h = WALL_H[k], pal = k === 'hi' ? [0xeef2f7, 0x9fb2cc, 0x7389a9] : k === 'lo' ? [0xcbd5e1, 0x94a3b8, 0x7d8da3] : [0xdbe4ee, 0xa8b8cf, 0x8497b3];
    box(g, `wall_${k}`, 1, h, pal[0], pal[1], pal[2], k === 'hi' ? (gg) => { // windows on the tall walls
      gg.fillStyle(0x7dd3fc).fillRect(6, 16 + 12, 8, 12).fillStyle(0x7dd3fc).fillRect(46, 16 + 12, 8, 12);
    } : undefined);
  });
  box(g, 'bed_emergency', 0.8, 6, 0xffffff, 0xe5e7eb, 0xcbd5e1, (gg) => diamond(gg, 26, 14, 0.25, 0xf87171));
  box(g, 'bed_outpatient', 0.8, 8, 0xbfdbfe, 0x93c5fd, 0x60a5fa, (gg) => diamond(gg, 26, 14, 0.25, 0xffffff));
  box(g, 'bed_inpatient', 0.8, 6, 0xffffff, 0xe5e7eb, 0xcbd5e1, (gg) => { diamond(gg, 38, 18, 0.5, 0x86efac); diamond(gg, 24, 13, 0.22, 0xfef3c7); });
  box(g, 'desk', 1, 12, 0x9a6b3f, 0x7c5a3a, 0x654a30);
  box(g, 'counter', 1, 14, 0x5eead4, 0x14b8a6, 0x0f766e);
  box(g, 'bench', 0.7, 6, 0x60a5fa, 0x3b82f6, 0x2563eb);
  box(g, 'cabinet', 0.6, 34, 0xe2e8f0, 0x94a3b8, 0x64748b, (gg) => gg.fillStyle(0x38bdf8).fillRect(24, 16 + 12, 4, 8));
  box(g, 'console', 0.55, 18, 0x38bdf8, 0x475569, 0x334155);
  box(g, 'kiosk', 0.55, 26, 0xfacc15, 0x475569, 0x334155);
  box(g, 'vending', 0.55, 34, 0xf87171, 0xb91c1c, 0x991b1b);
  box(g, 'hedge', 0.9, 14, 0x3f9d4d, 0x2a7a3a, 0x1f6030);
  box(g, 'board', 0.7, 38, 0x22d3ee, 0x1e293b, 0x0f172a, (gg) => gg.fillStyle(0x22d3ee).fillRect(20, 16 + 8, 12, 14));
  g.clear(); g.fillStyle(0x1e293b).fillRect(24, 4, 16, 12).fillStyle(0x38bdf8).fillRect(26, 6, 12, 8); g.generateTexture('monitor', 64, 24);
  g.clear(); g.fillStyle(0x8b5a2b).fillRect(28, 56, 8, 24).fillStyle(0x2e7d32).fillCircle(32, 44, 22).fillStyle(0x388e3c).fillCircle(22, 52, 16).fillCircle(44, 52, 16).fillStyle(0x43a047).fillCircle(32, 34, 14).generateTexture('tree', 64, 90);
  g.clear(); g.fillStyle(0x92400e).fillRect(26, 40, 12, 10).fillStyle(0x22c55e).fillCircle(32, 32, 10).fillCircle(25, 36, 7).fillCircle(39, 36, 7).generateTexture('plant', 64, 52);
  g.clear(); [[16, 14, 0xf472b6], [30, 20, 0xfacc15], [44, 12, 0xffffff], [38, 26, 0xf87171], [22, 26, 0xa78bfa]].forEach(([x, y, c]) => g.fillStyle(0x2f8f46).fillRect(x - 1, y, 3, 5).fillStyle(c as number).fillRect(x - 2, y - 3, 5, 4)); g.generateTexture('flowers', 64, 32);
  g.clear(); g.fillStyle(0x9ca3af).fillEllipse(32, 40, 60, 28).fillStyle(0x38bdf8).fillEllipse(32, 38, 48, 20).fillStyle(0xbae6fd).fillRect(30, 16, 4, 20).fillCircle(32, 14, 5).generateTexture('fountain', 64, 64);
  // people (14x26): head, body colour, legs
  const person = (k: string, body: number, accent = body) => { g.clear(); g.fillStyle(0xf1c9a5).fillRect(4, 0, 6, 6).fillStyle(0x3b2a1e).fillRect(4, 0, 6, 2); g.fillStyle(body).fillRect(2, 6, 10, 12).fillStyle(accent).fillRect(5, 7, 4, 6); g.fillStyle(0x1f2937).fillRect(3, 18, 3, 8).fillRect(8, 18, 3, 8); g.generateTexture(k, 14, 26); };
  [['private', 0x3b82f6], ['medicare', 0x14b8a6], ['medicaid', 0xa855f7], ['uninsured', 0xf59e0b], ['other', 0x9ca3af], ['unknown', 0x9ca3af]].forEach(([k, c]) => person(`p_${k}`, c as number));
  person('doctor', 0xffffff, 0x0f766e); person('nurse', 0x38bdf8, 0xffffff); person('admin', 0x0f766e, 0xfacc15);
  g.clear(); g.fillStyle(0x000000, 0.28).fillEllipse(8, 4, 16, 7).generateTexture('shadow', 16, 8);
  g.destroy();
}
