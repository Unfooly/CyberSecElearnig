'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// Czysta funkcja (bez domknięcia nad stanem komponentu) - poza komponentem, żeby applyEdgeState niżej (useCallback)
// mogło mieć stabilną tożsamość (puste deps, bez ostrzeżenia exhaustive-deps) mimo że jej wywołuje.
function edgeStateOf(container: HTMLElement) {
  return { left: container.scrollLeft > 0, right: container.scrollLeft < container.scrollWidth - container.clientWidth - 1 };
}

// Panorama sceny na telefonie w pionie (feat/player-portrait, sekcja B specyfikacji feat/player-stage). BEZ JS
// matchMedia (patrz komentarz w PlayerStage.tsx przy .player-frame - migotanie przy starcie/obrocie ekranu): CAŁA
// decyzja "czy panować" jest CSS-owa (globals.css, formuła szerokości sceny w breakpoincie
// max-width:767px/orientation:portrait/pointer:coarse zmienia się z "contain" na "fit-height", co CELOWO może dać
// scenę szerszą niż ekran) - ten komponent NIE replikuje tego zapytania w JS, tylko MIERZY rzeczywisty efekt
// (scrollWidth > clientWidth) przez ResizeObserver. Dzięki temu przy obrocie na poziomy formuła CSS sama wraca do
// "contain" (brak overflow), pomiar wykrywa 0 i komponent staje się w pełni bierny - bez osobnej logiki orientacji.
//
// Poza tym breakpointem (`.scene-pan-frame`/`.scene-pan-container` bez CSS-owej treści w tym breakpoincie) scena i
// tak nie ma overflow, więc `canPan` zawsze wychodzi `false` - te wrappery są wtedy niewidoczne funkcjonalnie
// (zwykłe divy w naturalnym przepływie, identyczne z tym, co było przed ich dodaniem).
//
// DWA zagnieżdżone divy, nie jeden (code review): `.scene-pan-frame` (zewnętrzny, NIEPRZEWIJANY, position:relative)
// i `.scene-pan-container` (wewnętrzny, PRZEWIJANY, overflow-x:auto) - cienie krawędzi/podpowiedź "przesuń" są
// dziećmi ZEWNĘTRZNEGO, bo position:absolute wewnątrz PRZEWIJANEGO kontenera pozycjonowałoby się względem jego
// scrollowanej treści i przesuwało razem ze sceną (real bug: prawy cień/podpowiedź wypadały poza ekranem albo w
// środku po starcie z przesunięciem od centroidu, złapane dopiero w code review, layout-check tego nie sprawdzał).
//
// `initialPanX` (0..1, fraction szerokości do przescrollowania, NIE piksele - liczone przez wołający na podstawie
// WŁASNYCH danych treści, np. centroid hotspotów danej sceny) - kontener sam przelicza na scrollLeft po zmierzeniu
// WŁASNEGO scrollWidth/clientWidth. Obserwujemy ZARÓWNO kontener, JAK I jego pierwsze dziecko (sizowana skrzynka
// sceny, .scene-box/.hotspot-nested-scene-box) - samo `.scene-pan-container` ma stały width/height:100% (nie
// zależy od --scene-ratio), więc ResizeObserver na NIM SAMYM nie wykryłby późniejszej zmiany szerokości dziecka po
// poznaniu prawdziwego aspect-ratio obrazu (onLoad w SceneHotspotsBlock.tsx) - realny bug złapany w code review:
// startowa pozycja i stan "czy panować" zostawały policzone na domyślnym 16/10, nie na prawdziwej proporcji.
// Dopóki user sam nie przewinie (pannedRef), KAŻDY pomiar (także ten po poznaniu prawdziwych wymiarów) na nowo
// ustawia scrollLeft na initialPanX - nie tylko pierwszy.
export default function ScenePanContainer({ initialPanX = 0.5, children }: { initialPanX?: number; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canPan, setCanPan] = useState(false);
  const [edge, setEdge] = useState({ left: false, right: false });
  const [hintVisible, setHintVisible] = useState(false);
  const pannedRef = useRef(false);
  // Programowe ustawienie scrollLeft (niżej) wysyła natywne zdarzenie "scroll" asynchronicznie (następna klatka) -
  // bez tej flagi handleScroll (onScroll na kontenerze) mylił je z prawdziwym gestem usera i chował podpowiedź
  // natychmiast po starcie, zanim user zdążył cokolwiek przewinąć sam (real bug, code review - wyścig między
  // ustawieniem stanu `canPan` a podpięciem `onScroll`, oba w tym samym renderze).
  const programmaticScrollRef = useRef(false);

  // setEdge tylko gdy wartość FAKTYCZNIE się zmienia (kod review - optymalizacja, nie poprawność) - bez tego każdy
  // scroll/pomiar tworzy nowy obiekt i re-renderuje komponent nawet wtedy, gdy oba cienie zostają w tym samym stanie
  // widoczności (np. środek długiej panoramy, daleko od obu krawędzi). useCallback z pustymi deps (setEdge ze
  // useState jest gwarantowanie stabilne między renderami) - stabilna tożsamość, żeby dep-array efektu niżej mogło
  // ją bezpiecznie zawierać bez ryzyka pętli re-tworzenia ResizeObservera co render.
  const applyEdgeState = useCallback((container: HTMLElement) => {
    const next = edgeStateOf(container);
    setEdge((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const child = container.firstElementChild as HTMLElement | null;

    function measure() {
      if (!container) return;
      const overflow = container.scrollWidth > container.clientWidth + 1;
      setCanPan(overflow);
      if (!overflow) {
        setEdge({ left: false, right: false });
        return;
      }
      if (!pannedRef.current) {
        const target = initialPanX * (container.scrollWidth - container.clientWidth);
        if (Math.abs(container.scrollLeft - target) > 0.5) {
          programmaticScrollRef.current = true;
          container.scrollLeft = target;
        }
      }
      applyEdgeState(container);
    }

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (child) observer.observe(child);
    return () => observer.disconnect();
  }, [initialPanX, applyEdgeState]);

  useEffect(() => {
    if (!canPan || pannedRef.current) {
      setHintVisible(false);
      return undefined;
    }
    setHintVisible(true);
    const timeout = setTimeout(() => setHintVisible(false), 3000);
    return () => clearTimeout(timeout);
  }, [canPan]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    if (programmaticScrollRef.current) {
      // Ten scroll to skutek naszego WŁASNEGO container.scrollLeft = ... wyżej, nie gest usera - policz cienie, ale
      // NIE licz tego jako "user zaczął panować" (podpowiedź ma zostać widoczna).
      programmaticScrollRef.current = false;
    } else if (!pannedRef.current) {
      pannedRef.current = true;
      setHintVisible(false);
    }
    applyEdgeState(container);
  }

  return (
    <div className="scene-pan-frame">
      <div ref={containerRef} className="scene-pan-container" data-initial-pan-x={initialPanX} onScroll={canPan ? handleScroll : undefined}>
        {children}
      </div>
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
