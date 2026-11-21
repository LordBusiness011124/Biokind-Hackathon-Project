/** The things in the hospital you can go to. Kept free of Phaser so the React shell can use it without loading the game engine. */
export interface WorkObject {
  id: string; key: string; short: string; label: string;
  /** Side-panel tab opened on arrival. */
  tab: string;
  /** Tile the object stands on, and the walkable tile the administrator stands on to use it. */
  x: number; y: number; stand: { x: number; y: number };
}
export const OBJECTS: WorkObject[] = [
  { id: 'desk', key: '1', short: 'Admin desk', label: 'Admin desk: manage the hospital', tab: 'manage', x: 16, y: 21, stand: { x: 16, y: 20 } },
  { id: 'er', key: '2', short: 'ER', label: 'ER console: staff and rooms', tab: 'manage', x: 13, y: 10, stand: { x: 13, y: 11 } },
  { id: 'ward', key: '3', short: 'Ward', label: 'Ward console: beds and staff', tab: 'manage', x: 23, y: 10, stand: { x: 23, y: 11 } },
  { id: 'clinic', key: '4', short: 'Clinic', label: 'Clinic console: staff and rooms', tab: 'manage', x: 25, y: 18, stand: { x: 25, y: 19 } },
  { id: 'board', key: '5', short: 'MEPS board', label: 'Reception board: the MEPS Lab', tab: 'data', x: 6, y: 21, stand: { x: 7, y: 21 } },
  { id: 'kiosk', key: '6', short: 'Kiosk', label: 'Info kiosk: why MEPS matters', tab: 'why', x: 30, y: 14, stand: { x: 30, y: 15 } },
];
