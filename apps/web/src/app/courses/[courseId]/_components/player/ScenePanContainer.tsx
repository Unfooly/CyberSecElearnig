'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Panorama sceny na telefonie w pionie (feat/player-portrait, sekcja B specyfikacji feat/player-stage). BEZ JS
// matchMedia (patrz komentarz w PlayerStage.tsx przy .player-frame - migotanie przy starcie/obrocie ekranu): CAŁA
// decyzja "czy panować" jest CSS-owa (globals.css, formuła szerokości sceny w breakpoincie
// max-width:767px/orientation:portrait/pointer:coarse zmienia się z "contain" na "fit-height", co CELOWO może dać
// scenę szerszą niż ekran) - ten komponent NIE replikuje tego zapytania w JS, tylko MIERZY rzeczywisty efekt
// (scrollWidth > clientWidth) przez ResizeObserver. Dzięki temu przy obrocie na poziomy formuła CSS sama wraca do
// "contain" (brak overflow), pomiar wykrywa 0 i komponent staje się w pełni bierny - bez osobnej logiki orientacji.
//
// Poza tym breakpointem (`.scene-pan-container` bez `overflow-x:auto` w CSS) scena i tak nie ma overflow, więc
// `canPan` zawsze wychodzi `false` - ten wrapper jest wtedy niewidoczny funkcjonalnie (zwykły flex-centering div,
// identyczny z tym, co było przed jego dodaniem).
//
// `initialPanX` (0..1, fraction szerokości do przescrollowania, NIE piksele - liczone przez wołający na podstawie
// WŁASNYCH danych treści, np. centroid hotspotów danej sceny) - ustawiane RAZ po zmierzeniu scrollWidth/clientWidth
// (nie zależy od natywnych wymiarów obrazu). `data-initial-pan-x` na kontenerze - do odczytu przez
// scripts/layout-check.mjs (sprawdza, że kontener zastosował wartość, którą dostał, bez duplikowania formuły
// centroidu w skrypcie testowym).
export default function ScenePanContainer({ initialPanX = 0.5, children }: { initialPanX?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canPan, setCanPan] = useState(false);
  const [edge, setEdge] = useState({ left: false, right: false });
  const [hintVisible, setHintVisible] = useState(false);
  const initializedRef = useRef(false);
  const pannedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function measureEdges() {
      if (!el) return;
      setEdge({ left: el.scrollLeft > 0, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 });
    }

    function measure() {
      if (!el) return;
      const overflow = el.scrollWidth > el.clientWidth + 1;
      setCanPan(overflow);
      if (!overflow) {
        setEdge({ left: false, right: false });
        return;
      }
      // Startowa pozycja ustawiona RAZ (initializedRef) - kolejne pomiary (np. po zmianie rozmiaru okna) nie mają
      // przestawiać scrolla, o który user może już zdążyć samodzielnie zawalczyć.
      if (!initializedRef.current) {
        initializedRef.current = true;
        el.scrollLeft = initialPanX * (el.scrollWidth - el.clientWidth);
      }
      measureEdges();
    }

    measure();
    // ResizeObserver (nie tylko window resize) - łapie też zmianę rozmiaru samej sceny niezależną od okna (np.
    // późniejsze poznanie prawdziwego aspect-ratio obrazu, SceneHotspotsBlock.tsx onLoad).
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // initialPanX celowo NIE w deps poza montażem - zmiana treści remountuje ten komponent przez `key` u wołającego
    // (ten sam wzorzec co AudioMedia), nie oczekujemy zmiany initialPanX na już zamontowanej scenie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canPan || pannedRef.current) {
      setHintVisible(false);
      return;
    }
    setHintVisible(true);
    const timeout = setTimeout(() => setHintVisible(false), 3000);
    return () => clearTimeout(timeout);
  }, [canPan]);

  function handleUserPan() {
    if (!pannedRef.current) {
      pannedRef.current = true;
      setHintVisible(false);
    }
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 0, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 });
  }

  return (
    <div
      ref={ref}
      className="scene-pan-container"
      data-initial-pan-x={initialPanX}
      onScroll={canPan ? handleUserPan : undefined}
      onTouchStart={canPan ? handleUserPan : undefined}
    >
      {children}
      {canPan && (
        <>
          <div aria-hidden="true" className={`scene-pan-edge scene-pan-edge--left ${edge.left ? 'scene-pan-edge--visible' : ''}`} />
          <div aria-hidden="true" className={`scene-pan-edge scene-pan-edge--right ${edge.right ? 'scene-pan-edge--visible' : ''}`} />
          {hintVisible && (
            <div aria-hidden="true" className="scene-pan-hint">
              Przesuń, aby zobaczyć więcej
            </div>
          )}
        </>
      )}
    </div>
  );
}
