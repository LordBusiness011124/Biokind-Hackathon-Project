import Phaser from 'phaser';
import type { Controller } from '../controller';
import type { Visit } from '@hospital/sim';
import { sfx } from '../audio';
import { DOORS, ENTRANCE, GH, GW, INTERACT, OX, ROOMS, SPAWN, WALL_H, WORLD_H, WORLD_W, bedTile, boxOrigin, buildMap, depthOf, findPath, makeTextures, proj, queueSpots, unproj, walkable, type Dept, type Tile } from './iso';

const DEPTS: Dept[] = ['emergency', 'inpatient', 'outpatient'];
const ROOM_OF: Record<Dept, string> = { emergency: 'er', inpatient: 'ip', outpatient: 'op' };
const QUEUE_CAP = 9;
const BOX_H: Record<string, number> = { desk: 12, counter: 14, bench: 6, cabinet: 34, console: 18, kiosk: 26, vending: 34, hedge: 18, board: 38 };
const CUSTOM_ORIGIN: Record<string, [number, number]> = { tree: [0.5, 0.86], plant: [0.5, 0.8], flowers: [0.5, 0.5], fountain: [0.5, 0.72], monitor: [0.5, 1] };
const BED_H: Record<Dept, number> = { emergency: 6, outpatient: 8, inpatient: 6 };

interface Person {
  spr: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; px: number; py: number; path: { x: number; y: number }[]; tgt: string;
  visit?: Visit; dying: boolean; reason?: string; speed: number; bob: number; staff?: { dept: Dept; timer: number };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class HospitalScene extends Phaser.Scene {
  private ctl!: Controller;
  private tiles!: Tile[][];
  private people = new Map<string, Person>();
  private staff: Person[] = [];
  private player!: Person; private pg = { x: 16.5, y: 20.4 };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private prompt!: Phaser.GameObjects.Text;
  private beds: Record<Dept, Phaser.GameObjects.Image[]> = { emergency: [], inpatient: [], outpatient: [] };
  private slotOf = new Map<string, number>();
  private wardSign!: Phaser.GameObjects.Text;
  private overflow: Partial<Record<Dept, Phaser.GameObjects.Text>> = {};
  private ring!: Phaser.GameObjects.Graphics;
  private reconTimer = 0; private staffSig = '';
  private t = 0; private interactQueued = false;

  constructor() { super('Hospital'); }

  create() {
    this.ctl = this.registry.get('ctl') as Controller;
    makeTextures(this);
    const { tiles, props } = buildMap(); this.tiles = tiles;
    // floors & walls
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const t = tiles[y][x], p = proj(x + 0.5, y + 0.5);
      if (t.kind === 'wall') { const h = WALL_H[t.wall!]; this.add.image(p.x, p.y, `wall_${t.wall}`).setOrigin(0.5, boxOrigin(h)).setDepth(depthOf(x + 0.5, y + 0.5)); continue; }
      const fk = t.kind === 'tree' || t.kind === 'hedge' || t.kind === 'fountain' ? 'grass' : t.kind;
      this.add.image(p.x, p.y, `f_${fk}_${(x + y) % 2}`).setDepth(0);
    }
    props.forEach((pr) => {
      const p = proj(pr.x + 0.5, pr.y + 0.5), o = CUSTOM_ORIGIN[pr.tex] ?? [0.5, boxOrigin(BOX_H[pr.tex] ?? 0)];
      this.add.image(p.x, p.y + (pr.dy ?? 0), pr.tex).setOrigin(o[0], o[1]).setDepth(depthOf(pr.x + 0.5, pr.y + 0.5, pr.tex === 'monitor' ? 5 : pr.tex === 'flowers' ? -50 : 0));
    });
    Object.values(ROOMS).forEach((r) => { const p = proj(r.x0 + 1.2, r.y0 + 0.9); this.add.text(p.x, p.y, r.label, { fontFamily: 'monospace', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffffcc', padding: { x: 3, y: 1 } }).setResolution(2).setOrigin(0.5).setDepth(9e5); });
    const e = proj(ENTRANCE.x + 0.5, ENTRANCE.y + 0.5); this.add.text(e.x, e.y - 40, '▼ ENTRANCE', { fontFamily: 'monospace', fontSize: '14px', color: '#fff', backgroundColor: '#15803dcc', padding: { x: 4, y: 2 } }).setResolution(2).setOrigin(0.5).setDepth(9e5);
    const w = proj(25, 8); this.wardSign = this.add.text(w.x, w.y, '', { fontFamily: 'monospace', fontSize: '14px', color: '#fef3c7', backgroundColor: '#7c2d12dd', padding: { x: 5, y: 3 }, align: 'center' }).setResolution(2).setOrigin(0.5).setDepth(9e5);
    DEPTS.forEach((d) => { const s = queueSpots(d)[QUEUE_CAP - 1], p = proj(s.x + 0.5, s.y + 1.2); this.overflow[d] = this.add.text(p.x, p.y, '', { fontFamily: 'monospace', fontSize: '13px', color: '#7f1d1d', backgroundColor: '#fee2e2cc', padding: { x: 3, y: 1 } }).setResolution(2).setOrigin(0.5).setDepth(9e5); });
    this.ring = this.add.graphics().setDepth(8e5);
    this.player = this.makePerson('admin', this.pg.x, this.pg.y);
    this.prompt = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '15px', color: '#fff', backgroundColor: '#0f172aee', padding: { x: 5, y: 3 } }).setResolution(2).setDepth(9.5e5).setVisible(false);
    const cam = this.cameras.main; cam.setBounds(0, 0, WORLD_W, WORLD_H); cam.setZoom(0.72); cam.startFollow(this.player.spr, true, 0.12, 0.12);
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => cam.setZoom(clamp(cam.zoom - dy * 0.001, 0.55, 1.6)));
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const hit = over.find((o) => o.getData('vid')); if (hit) this.ctl.select(this.people.get(hit.getData('vid'))?.visit ?? null); else if (!over.length) this.ctl.select(null);
    });
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,M') as Record<string, Phaser.Input.Keyboard.Key>;
    // tap-style keys are event driven so very short key presses are never missed between frames
    this.input.keyboard!.on('keydown-E', () => { this.interactQueued = true; });
    this.input.keyboard!.on('keydown-SPACE', () => this.ctl.togglePause());
    this.input.keyboard!.on('keydown-M', () => this.ctl.toggleMute());
    this.events.once('shutdown', () => { this.people.clear(); this.staff = []; });
  }

  // ---------- people ----------
  private makePerson(tex: string, gx: number, gy: number): Person {
    const spr = this.add.image(0, 0, tex).setOrigin(0.5, 0.92).setScale(1.5), shadow = this.add.image(0, 0, 'shadow').setScale(1.5);
    const p: Person = { spr, shadow, px: gx, py: gy, path: [], tgt: '', dying: false, speed: 2.4, bob: Math.random() * 6 };
    this.place(p); return p;
  }
  private place(p: Person) {
    const s = proj(p.px, p.py), moving = p.path.length > 0, bob = moving ? Math.abs(Math.sin(this.t * 9 + p.bob)) * 2 : 0;
    p.spr.setPosition(Math.round(s.x), Math.round(s.y - bob)).setDepth(depthOf(p.px, p.py, 50)); p.shadow.setPosition(Math.round(s.x), Math.round(s.y + 1)).setDepth(depthOf(p.px, p.py, 49));
  }
  private goTo(p: Person, tx: number, ty: number) {
    const k = `${tx},${ty}`; if (p.tgt === k) return; p.tgt = k;
    const here = { x: clamp(Math.floor(p.px), 0, GW - 1), y: clamp(Math.floor(p.py), 0, GH - 1) };
    p.path = findPath(this.tiles, here, { x: tx, y: ty });
    if (!p.path.length && (here.x !== tx || here.y !== ty)) { p.px = tx + 0.5; p.py = ty + 0.5; }
  }
  private destroyPerson(p: Person) { p.spr.destroy(); p.shadow.destroy(); }

  // ---------- main loop ----------
  update(_t: number, dtMs: number) {
    const dt = Math.min(dtMs, 100) / 1000; this.t += dt;
    this.movePlayer(dt);
    // interactions
    const near = INTERACT.find((o) => Math.hypot(this.pg.x - (o.x + 0.5), this.pg.y - (o.y + 0.5)) < 1.9);
    if (near) { const s = proj(this.pg.x, this.pg.y); this.prompt.setText(`E: ${near.label}`).setPosition(s.x - 70, s.y - 60).setVisible(true); if (this.interactQueued) { sfx.ui(); this.ctl.openTab(near.tab); } }
    else this.prompt.setVisible(false);
    this.interactQueued = false;
    // outcome events -> popups / sounds
    const ev = this.ctl.events.splice(0, this.ctl.events.length);
    ev.forEach((e) => {
      const p = this.people.get(e.visit.id);
      if (e.type === 'leave') { if (p) p.reason = e.reason; sfx.leave(); }
      else if (e.type === 'complete') {
        sfx.paid();
        if (p && e.revenueCents > 0) { const s = proj(p.px, p.py); const tx = this.add.text(s.x, s.y - 30, `+$${Math.round(e.revenueCents / 100).toLocaleString('en-US')}`, { fontFamily: 'monospace', fontSize: '15px', color: '#bbf7d0', stroke: '#052e16', strokeThickness: 3 }).setResolution(2).setOrigin(0.5).setDepth(9.6e5);
          this.tweens.add({ targets: tx, y: tx.y - 34, alpha: 0, duration: 1100, onComplete: () => tx.destroy() }); }
      }
    });
    this.syncBeds(); this.reconTimer += dt;
    if (this.reconTimer > 0.12) { this.reconTimer = 0; this.reconcile(); }
    // walk everyone
    const spd = Math.max(1, this.ctl.speed * 0.55) * (this.ctl.paused ? 0.6 : 1);
    const step = (p: Person, mult = 1) => {
      let budget = p.speed * spd * mult * dt;
      while (p.path.length && budget > 0) {
        const w = p.path[0], dx = w.x + 0.5 - p.px, dy = w.y + 0.5 - p.py, d = Math.hypot(dx, dy);
        if (d <= budget) { p.px = w.x + 0.5; p.py = w.y + 0.5; p.path.shift(); budget -= d; } else { p.px += (dx / d) * budget; p.py += (dy / d) * budget; budget = 0; }
      }
      this.place(p);
    };
    this.people.forEach((p, id) => {
      step(p);
      if (p.dying && !p.path.length) { this.destroyPerson(p); this.people.delete(id); }
    });
    this.staff.forEach((s) => {
      step(s, 0.55); s.staff!.timer -= dt;
      if (s.staff!.timer <= 0 && !s.path.length) {
        s.staff!.timer = 2 + Math.random() * 6; const r = ROOMS[ROOM_OF[s.staff!.dept]];
        for (let tries = 0; tries < 12; tries++) { const x = Phaser.Math.Between(r.x0, r.x1), y = Phaser.Math.Between(r.y0, r.y1); if (walkable(this.tiles, x, y)) { this.goTo(s, x, y); break; } }
      }
    });
    this.drawRing();
    const open = this.ctl.sim.state.departments.inpatient.roomSlots > 0;
    this.wardSign.setText(open ? '' : 'WARD CLOSED\nBuild beds & hire staff in Manage');
    this.player.spr.setDepth(depthOf(this.pg.x, this.pg.y, 60));
  }

  private movePlayer(dt: number) {
    const L = this.cursors.left.isDown || this.keys.A.isDown, R = this.cursors.right.isDown || this.keys.D.isDown;
    const U = this.cursors.up.isDown || this.keys.W.isDown, D = this.cursors.down.isDown || this.keys.S.isDown;
    let vx = (R ? 1 : 0) - (L ? 1 : 0), vy = (D ? 1 : 0) - (U ? 1 : 0); const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const n = Math.hypot(vx, vy); vx = (vx / n) * 150 * dt; vy = (vy / n) * 150 * dt;       // screen pixels this frame
      const dgx = (vx / 32 + vy / 16) / 2, dgy = (vy / 16 - vx / 32) / 2, r = 0.22;
      const ok = (x: number, y: number) => walkable(this.tiles, Math.floor(x - r), Math.floor(y - r)) && walkable(this.tiles, Math.floor(x + r), Math.floor(y - r)) && walkable(this.tiles, Math.floor(x - r), Math.floor(y + r)) && walkable(this.tiles, Math.floor(x + r), Math.floor(y + r));
      if (ok(this.pg.x + dgx, this.pg.y)) this.pg.x += dgx;
      if (ok(this.pg.x, this.pg.y + dgy)) this.pg.y += dgy;
    }
    this.player.px = this.pg.x; this.player.py = this.pg.y; this.player.path = moving ? [{ x: 0, y: 0 }] : [];
    this.place(this.player); this.player.path = [];
  }

  private drawRing() {
    this.ring.clear(); const sel = this.ctl.selected; if (!sel) return;
    const p = this.people.get(sel.id); if (!p) return; const s = proj(p.px, p.py);
    this.ring.lineStyle(3, 0xfacc15, 1).strokeEllipse(s.x, s.y, 34, 17);
  }

  private syncBeds() {
    DEPTS.forEach((d) => {
      const n = this.ctl.sim.state.departments[d].roomSlots, arr = this.beds[d];
      for (let i = arr.length; i < n; i++) { const t = bedTile(d, i), p = proj(t.x + 0.5, t.y + 0.5); arr.push(this.add.image(p.x, p.y, `bed_${d}`).setOrigin(0.5, boxOrigin(BED_H[d])).setDepth(depthOf(t.x + 0.5, t.y + 0.5, -5))); }
      while (arr.length > n) arr.pop()!.destroy();
    });
  }

  /** Make displayed people mirror the simulation: queues in the corridor, in-service patients in beds, staff roaming their rooms. */
  private reconcile() {
    const s = this.ctl.sim.state, live = new Set<string>(); const sel = this.ctl.selected?.id;
    DEPTS.forEach((svc) => {
      const d = s.departments[svc], spots = queueSpots(svc), used = new Set<number>();
      d.inService.forEach((a) => { const sl = this.slotOf.get(a.visit.id); if (sl !== undefined) used.add(sl); });
      d.inService.forEach((a) => {
        let sl = this.slotOf.get(a.visit.id);
        if (sl === undefined) { sl = 0; while (used.has(sl)) sl++; if (d.roomSlots > 0) sl %= d.roomSlots; used.add(sl); this.slotOf.set(a.visit.id, sl); }
        const t = bedTile(svc, sl); this.show(a.visit, t.x, t.y, live, svc, false);
      });
      d.queue.slice(0, QUEUE_CAP).forEach((v, i) => this.show(v, spots[i].x, spots[i].y, live, svc, true));
      const extra = d.queue.length - QUEUE_CAP; this.overflow[svc]!.setText(extra > 0 ? `+${extra} more waiting` : '');
    });
    this.people.forEach((p, id) => {
      if (!live.has(id) && !p.dying) { p.dying = true; this.slotOf.delete(id); p.tgt = ''; this.goTo(p, SPAWN.x, SPAWN.y); p.spr.setTint(p.reason ? 0xff6b6b : 0xffffff); if (!p.path.length) p.path = [{ x: SPAWN.x, y: SPAWN.y }]; }
      p.spr.setAlpha(id === sel ? 1 : p.dying ? 0.8 : 1);
    });
    // staff sprites: one per employee up to a cap, so hiring is visible
    const sig = DEPTS.map((d) => `${s.departments[d].physicians}/${s.departments[d].nurses}`).join('|');
    if (sig !== this.staffSig) {
      this.staffSig = sig; this.staff.forEach((p) => this.destroyPerson(p)); this.staff = [];
      DEPTS.forEach((d) => { const r = ROOMS[ROOM_OF[d]], dep = s.departments[d];
        const mk = (tex: string, n: number) => { for (let i = 0; i < Math.min(n, 6); i++) { const x = Phaser.Math.Between(r.x0, r.x1), y = Phaser.Math.Between(r.y0, r.y1); if (!walkable(this.tiles, x, y)) continue; const p = this.makePerson(tex, x + 0.5, y + 0.5); p.staff = { dept: d, timer: Math.random() * 4 }; this.staff.push(p); } };
        mk('doctor', dep.physicians); mk('nurse', dep.nurses); });
    }
  }

  private show(v: Visit, tx: number, ty: number, live: Set<string>, svc: Dept, waiting: boolean) {
    live.add(v.id); let p = this.people.get(v.id);
    if (!p) {
      const fresh = v.arrivalTick >= this.ctl.sim.state.tick - 8;
      const from = fresh ? SPAWN : waiting ? { x: tx, y: ty } : { x: DOORS[ROOM_OF[svc]].x, y: DOORS[ROOM_OF[svc]].y };
      p = this.makePerson(`p_${v.patient.payer}`, from.x + 0.5, from.y + 0.5); p.visit = v; p.spr.setInteractive({ useHandCursor: true }).setData('vid', v.id); this.people.set(v.id, p);
    }
    this.goTo(p, tx, ty);
  }
}
void unproj; void OX;
