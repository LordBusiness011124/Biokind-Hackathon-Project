import Phaser from 'phaser';
import type { Controller } from '../controller';
import type { PayerGroup, PlayableService, Visit } from '@hospital/sim';

const W = 960, H = 540;
const PAYER_COLORS: Record<string, number> = { private: 0x3b82f6, medicare: 0x14b8a6, medicaid: 0xa855f7, uninsured: 0xf59e0b, other: 0x9ca3af, unknown: 0x9ca3af };
const ENTRANCE = { x: 14, y: 205 };
const QUEUE_CAP = 18;

// wall rectangles [x, y, w, h]; gaps are doors
const WALLS: [number, number, number, number][] = [
  [0, 0, W, 12], [0, H - 12, W, 12], [W - 12, 0, 12, H],               // outer top/bottom/right
  [0, 0, 12, 170], [0, 240, 12, H - 240],                              // outer left with entrance gap y170-240
  [336, 12, 8, 108], [336, 168, 8, 192], [336, 408, 8, H - 420],       // hall | departments (ER door 120-168, OP door 360-408)
  [344, 266, 316, 8],                                                   // ER | OP
  [12, 400, 138, 8], [200, 400, 136, 8],                                // hall | admin (door 150-200)
  [660, 12, 8, H - 24],                                                 // departments | locked ward
];

const SPOTS: Record<PlayableService, { bed: (i: number) => { x: number; y: number }; queue: (i: number) => { x: number; y: number }; label: { x: number; y: number } }> = {
  emergency: { bed: (i) => ({ x: 380 + (i % 5) * 56, y: 56 + Math.floor(i / 5) * 46 }), queue: (i) => ({ x: 310 - (i % 6) * 24, y: 120 + Math.floor(i / 6) * 22 }), label: { x: 352, y: 26 } },
  outpatient: { bed: (i) => ({ x: 380 + (i % 5) * 56, y: 312 + Math.floor(i / 5) * 46 }), queue: (i) => ({ x: 310 - (i % 6) * 24, y: 385 - Math.floor(i / 6) * 22 }), label: { x: 352, y: 282 } },
};
const INTERACTABLES = [
  { x: 176, y: 470, r: 46, tab: 'manage', label: 'Admin desk: manage hospital' },
  { x: 150, y: 70, r: 50, tab: 'data', label: 'Reception board: why these patients?' },
  { x: 372, y: 200, r: 46, tab: 'manage', label: 'ER console: staffing & rooms' },
  { x: 372, y: 460, r: 46, tab: 'manage', label: 'Clinic console: staffing & rooms' },
];

interface PSprite { spr: Phaser.GameObjects.Image; visit: Visit; dying: boolean; reason?: string; }

export class HospitalScene extends Phaser.Scene {
  private ctl!: Controller;
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private sprites = new Map<string, PSprite>();
  private prompt!: Phaser.GameObjects.Text;
  private beds!: Phaser.GameObjects.Graphics;
  private overflow: Record<PlayableService, Phaser.GameObjects.Text> = {} as never;
  private lastBedSig = '';
  private reconTimer = 0;
  private spawnAcc = 0;

  constructor() { super('Hospital'); }

  create() {
    this.ctl = this.registry.get('ctl') as Controller;
    this.makeTextures(); this.drawMap();
    const walls = this.physics.add.staticGroup();
    WALLS.forEach(([x, y, w, h]) => { const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x334155); this.physics.add.existing(r, true); walls.add(r); });
    this.beds = this.add.graphics().setDepth(2);
    this.player = this.physics.add.sprite(176, 440, 'admin').setDepth(100).setCollideWorldBounds(true);
    (this.player.body as Phaser.Physics.Arcade.Body).setSize(12, 12).setOffset(2, 12);
    this.physics.add.collider(this.player, walls);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.prompt = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#fff', backgroundColor: '#0f172aee', padding: { x: 5, y: 3 } }).setDepth(200).setVisible(false);
    (['emergency', 'outpatient'] as PlayableService[]).forEach((s) => { this.overflow[s] = this.add.text(SPOTS[s].queue(0).x - 40, SPOTS[s].queue(0).y + (s === 'emergency' ? 70 : -70), '', { fontFamily: 'monospace', fontSize: '11px', color: '#fca5a5' }).setDepth(50); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const hit = over.find((o) => o.getData('vid')); if (hit) this.ctl.select(this.sprites.get(hit.getData('vid'))?.visit ?? null); else if (!over.length) this.ctl.select(null);
    });
    this.events.once('shutdown', () => this.sprites.clear());
  }

  private makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    Object.entries(PAYER_COLORS).forEach(([k, c]) => {
      g.clear(); g.fillStyle(0xf1c9a5).fillRect(3, 0, 6, 6); g.fillStyle(c).fillRect(2, 6, 8, 10); g.fillStyle(0x1f2937).fillRect(3, 16, 2, 4).fillRect(7, 16, 2, 4);
      g.generateTexture(`p_${k}`, 12, 20);
    });
    g.clear(); g.fillStyle(0xf1c9a5).fillRect(4, 0, 6, 6); g.fillStyle(0x0f766e).fillRect(2, 6, 10, 10); g.fillStyle(0xfacc15).fillRect(9, 8, 3, 3); g.fillStyle(0x1f2937).fillRect(4, 16, 2, 6).fillRect(8, 16, 2, 6);
    g.generateTexture('admin', 14, 22); g.destroy();
  }

  private drawMap() {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x0b1220).fillRect(0, 0, W, H);
    const room = (x: number, y: number, w: number, h: number, a: number, b: number) => { for (let ty = 0; ty < h; ty += 16) for (let tx = 0; tx < w; tx += 16) { g.fillStyle(((tx + ty) / 16) % 2 ? a : b).fillRect(x + tx, y + ty, 16, 16); } };
    room(12, 12, 324, 388, 0xcfe3ea, 0xc3d9e2);      // waiting hall
    room(12, 408, 324, H - 420, 0xe9dcc3, 0xe2d4b8);  // admin office
    room(344, 12, 316, 254, 0xd7f0e5, 0xcdeadc);      // ER
    room(344, 274, 316, H - 286, 0xdbe8f9, 0xd1e0f4); // clinic
    room(668, 12, W - 680, H - 24, 0x3b4252, 0x373d4b); // locked ward
    const t = (x: number, y: number, s: string, c = '#0f172a') => this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: '11px', color: c }).setDepth(3);
    t(20, 18, 'RECEPTION / WAITING'); t(352, 18, 'EMERGENCY DEPT'); t(352, 280, 'OUTPATIENT CLINIC'); t(20, 414, 'ADMIN OFFICE');
    t(690, 220, 'INPATIENT WARD', '#94a3b8'); t(690, 238, '(locked: needs HC-254D', '#94a3b8'); t(690, 252, 'bed-stay calibration)', '#94a3b8');
    t(ENTRANCE.x - 2, 160, 'ENTRANCE', '#475569');
    // props
    g.fillStyle(0x7c5a3a).fillRect(136, 456, 80, 26);             // admin desk
    g.fillStyle(0x38bdf8).fillRect(166, 458, 20, 10);             // monitor
    g.fillStyle(0x1e293b).fillRect(110, 44, 80, 40); g.fillStyle(0x22d3ee).fillRect(114, 48, 72, 32); // reception board
    g.fillStyle(0x475569).fillRect(352, 188, 18, 26).fillRect(352, 448, 18, 26);                      // consoles
    g.fillStyle(0xfacc15).fillRect(176, 400, 0, 0);
  }

  private drawBeds() {
    const s = this.ctl.sim.state, sig = `${s.departments.emergency.roomSlots}|${s.departments.outpatient.roomSlots}|${s.departments.emergency.nurses}|${s.departments.emergency.physicians}|${s.departments.outpatient.nurses}|${s.departments.outpatient.physicians}`;
    if (sig === this.lastBedSig) return; this.lastBedSig = sig;
    const g = this.beds; g.clear();
    (['emergency', 'outpatient'] as PlayableService[]).forEach((svc) => {
      const d = s.departments[svc];
      for (let i = 0; i < d.roomSlots; i++) { const p = SPOTS[svc].bed(i); g.fillStyle(0xffffff).fillRect(p.x - 16, p.y - 8, 32, 20); g.fillStyle(svc === 'emergency' ? 0xf87171 : 0x60a5fa).fillRect(p.x - 16, p.y - 8, 32, 5); }
      // staff dots (1 dot per employee, capped) make hiring visible
      const base = SPOTS[svc].label; let n = 0;
      for (let i = 0; i < Math.min(d.physicians, 24); i++, n++) { g.fillStyle(0xffffff).fillRect(base.x + 130 + (n % 12) * 9, base.y - 4 + Math.floor(n / 12) * 10, 7, 7); g.fillStyle(0x0f766e).fillRect(base.x + 132 + (n % 12) * 9, base.y - 2 + Math.floor(n / 12) * 10, 3, 3); }
      for (let i = 0; i < Math.min(d.nurses, 24); i++, n++) { g.fillStyle(0x2563eb).fillRect(base.x + 130 + (n % 12) * 9, base.y - 4 + Math.floor(n / 12) * 10, 7, 7); }
    });
  }

  update(_t: number, dtMs: number) {
    const dt = dtMs / 1000;
    // player movement
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const L = this.cursors.left.isDown || this.keys.A.isDown, R = this.cursors.right.isDown || this.keys.D.isDown;
    const U = this.cursors.up.isDown || this.keys.W.isDown, D = this.cursors.down.isDown || this.keys.S.isDown;
    body.setVelocity((R ? 1 : 0) - (L ? 1 : 0), (D ? 1 : 0) - (U ? 1 : 0)); if (body.velocity.lengthSq() > 0) body.velocity.normalize().scale(150);
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.ctl.togglePause();
    // interactions
    const near = INTERACTABLES.find((o) => Phaser.Math.Distance.Between(this.player.x, this.player.y, o.x, o.y) < o.r);
    if (near) { this.prompt.setText(`E: ${near.label}`).setPosition(this.player.x - 60, this.player.y - 40).setVisible(true); if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.ctl.openTab(near.tab); }
    else this.prompt.setVisible(false);
    this.drawBeds();
    // consume outcome events (colour of leaving patients)
    const ev = this.ctl.events.splice(0, this.ctl.events.length);
    ev.forEach((e) => { if (e.type === 'leave') { const p = this.sprites.get(e.visit.id); if (p) p.reason = e.reason; } });
    this.reconTimer += dt; this.spawnAcc += dt;
    if (this.reconTimer > 0.12) { this.reconTimer = 0; this.reconcile(); }
    // move sprites toward targets
    const speed = 150 * Math.max(1, this.ctl.speed * 0.7);
    this.sprites.forEach((p, id) => {
      const tgt = p.spr.getData('tx') !== undefined ? { x: p.spr.getData('tx') as number, y: p.spr.getData('ty') as number } : ENTRANCE;
      const dx = tgt.x - p.spr.x, dy = tgt.y - p.spr.y, d = Math.hypot(dx, dy), step = speed * dt;
      if (d <= step) { p.spr.setPosition(tgt.x, tgt.y); if (p.dying) { p.spr.destroy(); this.sprites.delete(id); } }
      else p.spr.setPosition(p.spr.x + (dx / d) * step, p.spr.y + (dy / d) * step);
      p.spr.setDepth(10 + p.spr.y / 10);
    });
  }

  /** Make the displayed patients mirror the simulation's queues and in-service lists (capped sample). */
  private reconcile() {
    const live = new Set<string>(); const sel = this.ctl.selected?.id;
    (['emergency', 'outpatient'] as PlayableService[]).forEach((svc) => {
      const d = this.ctl.sim.state.departments[svc];
      d.inService.forEach((av, i) => this.place(av.visit, SPOTS[svc].bed(i % Math.max(1, d.roomSlots)), live, true));
      d.queue.slice(0, QUEUE_CAP).forEach((v, i) => this.place(v, SPOTS[svc].queue(i), live, false));
      const extra = d.queue.length - QUEUE_CAP;
      this.overflow[svc].setText(extra > 0 ? `+${extra} more waiting (sampled view)` : '');
    });
    this.sprites.forEach((p) => {
      if (!live.has(p.visit.id) && !p.dying) { p.dying = true; p.spr.setData('tx', ENTRANCE.x); p.spr.setData('ty', ENTRANCE.y); p.spr.setTint(p.reason ? 0xff6b6b : 0xffffff); }
      p.spr.setAlpha(p.visit.id === sel ? 1 : p.dying ? 0.75 : 0.95);
    });
  }
  private place(v: Visit, pos: { x: number; y: number }, live: Set<string>, inBed: boolean) {
    live.add(v.id);
    let p = this.sprites.get(v.id);
    if (!p) {
      const spr = this.add.image(ENTRANCE.x, ENTRANCE.y, `p_${v.patient.payer as PayerGroup}`).setInteractive({ useHandCursor: true }).setData('vid', v.id);
      p = { spr, visit: v, dying: false }; this.sprites.set(v.id, p);
    }
    p.spr.setData('tx', pos.x).setData('ty', pos.y + (inBed ? 6 : 0));
  }
}
