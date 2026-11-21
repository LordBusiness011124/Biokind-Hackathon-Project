import { useEffect, useRef } from 'react';
import type { Controller } from '../controller';

/** Phaser is dynamically imported so the React shell and onboarding load first. */
export function Game({ ctl }: { ctl: Controller }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let game: { destroy: (b: boolean) => void } | null = null, dead = false;
    void (async () => {
      const [{ default: Phaser }, { HospitalScene }] = await Promise.all([import('phaser'), import('./HospitalScene')]);
      if (dead || !ref.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: ref.current, width: 960, height: 540, backgroundColor: '#0b1220', pixelArt: true, roundPixels: true,
        scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [HospitalScene], callbacks: { preBoot: (g) => g.registry.set('ctl', ctl) },
      });
    })();
    return () => { dead = true; game?.destroy(true); };
  }, [ctl]);
  return <div ref={ref} className="game-host" role="application" aria-label="Isometric hospital map. Move with WASD or arrow keys, press E to interact, Space to pause, M to mute." />;
}
