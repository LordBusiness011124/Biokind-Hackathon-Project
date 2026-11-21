import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Controller } from '../controller';
import { HospitalScene } from './HospitalScene';

export function Game({ ctl }: { ctl: Controller }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: ref.current, width: 960, height: 540, backgroundColor: '#0b1220', pixelArt: true, roundPixels: true,
      physics: { default: 'arcade', arcade: { debug: false } },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [HospitalScene], callbacks: { preBoot: (g) => g.registry.set('ctl', ctl) },
    });
    return () => game.destroy(true);
  }, [ctl]);
  return <div ref={ref} className="game-host" role="application" aria-label="Hospital map. Move with WASD or arrow keys, press E to interact, Space to pause." />;
}
