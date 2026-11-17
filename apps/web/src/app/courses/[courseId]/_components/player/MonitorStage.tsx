import type { CSSProperties, ReactNode } from 'react';
import monitor from '@/lib/player-monitor.json';

// Quiz w monitorze (szablon modułu Unfooly, D-164): wspólna grafika monitora (apps/web/public/player/monitor.webp) i prostokąt jej białego
// ekranu z manifestu liczonego skryptem (scripts/content/scenes/monitor-screen.ts) - treść pytania leży DOKŁADNIE na ekranie i przewija się
// w nim, gdy się nie mieści. Szeroko (kontener `monitor` ≥ 640 px i ≥ 420 px wysokości): monitor wpisany w obszar bloku („contain”) na tle
// #1B1424. Wąsko albo nisko (telefon, telefon w poziomie): przygaszony monitor na tło (cover, 55%) i biała karta w ciemnej ramce 10 px,
// r16, z fioletową poświatą - globals.css (.monitor-stage*).

export default function MonitorStage({ label, children }: { label: string; children: ReactNode }) {
  const { screen } = monitor;
  const style = {
    '--monitor-ratio': `${monitor.width} / ${monitor.height}`,
    '--monitor-ratio-n': monitor.width / monitor.height,
    '--screen-left': `${screen.left}%`,
    '--screen-top': `${screen.top}%`,
    '--screen-width': `${screen.width}%`,
    '--screen-height': `${screen.height}%`,
  } as CSSProperties;
  return (
    <div data-testid="monitor-stage" className="monitor-stage" style={style}>
      <div className="monitor-stage-frame">
        {/* Grafika dekoracyjna - treść ekranu jest w sekcji obok. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/player/monitor.webp" alt="" aria-hidden="true" className="monitor-stage-img" />
        <section aria-label={label} data-testid="monitor-screen" className="monitor-stage-screen">
          {children}
        </section>
      </div>
    </div>
  );
}
