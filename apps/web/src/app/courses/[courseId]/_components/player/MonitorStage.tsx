import type { CSSProperties, ReactNode } from 'react';
import monitor from '@/lib/player-monitor.json';
import Illustrated from '../blocks/Illustrated';

// Quiz w monitorze (szablon modułu Unfooly, D-164): wspólna grafika monitora (apps/web/public/player/monitor.webp) i prostokąt jej białego
// ekranu z manifestu liczonego skryptem (scripts/content/scenes/monitor-screen.ts) - treść pytania leży DOKŁADNIE na ekranie i przewija się
// w nim, gdy się nie mieści. Szeroko (kontener `monitor` ≥ 640 px i ≥ 420 px wysokości): monitor wpisany w obszar bloku („contain”) na tle
// #1B1424. Wąsko albo nisko (telefon, telefon w poziomie): przygaszony monitor na tło (cover, 55%) i biała karta w ciemnej ramce 10 px,
// r16, z fioletową poświatą - globals.css (.monitor-stage*).

export default function MonitorStage({
  label,
  illustration,
  contentBase = '',
  children,
}: {
  label: string;
  /** Ilustracja obok pytania (D-200) - na ekranie monitora, obok treści (komputer) albo nad nią (telefon). */
  illustration?: { image: string; alt: string };
  contentBase?: string;
  children: ReactNode;
}) {
  const { screen } = monitor;
  const style = {
    '--monitor-ratio': `${monitor.width} / ${monitor.height}`,
    '--monitor-ratio-n': monitor.width / monitor.height,
    '--screen-left': `${screen.left}%`,
    '--screen-top': `${screen.top}%`,
    '--screen-width': `${screen.width}%`,
    '--screen-height': `${screen.height}%`,
    // Powiększenie (uwaga właściciela 2026-11-17: większy monitor): ramka skalowana tak, żeby EKRAN wypełniał obszar bloku, a środek
    // ekranu leżał na środku obszaru - reszta grafiki (biurko, krawędzie) wychodzi poza obszar i jest przycinana.
    '--screen-w-n': screen.width / 100,
    '--screen-h-n': screen.height / 100,
    '--screen-cx': `${screen.left + screen.width / 2}%`,
    '--screen-cy': `${screen.top + screen.height / 2}%`,
  } as CSSProperties;
  return (
    <div data-testid="monitor-stage" className="monitor-stage" style={style}>
      <div className="monitor-stage-frame">
        {/* Grafika dekoracyjna - treść ekranu jest w sekcji obok. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/player/monitor.webp" alt="" aria-hidden="true" className="monitor-stage-img" />
        <section aria-label={label} data-testid="monitor-screen" className="monitor-stage-screen">
          <Illustrated illustration={illustration} contentBase={contentBase} screen>
            {children}
          </Illustrated>
        </section>
      </div>
    </div>
  );
}
