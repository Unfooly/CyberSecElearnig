'use client';

import { useId } from 'react';
import { X } from 'lucide-react';
import Mascot from '@/components/Mascot';
import { useMascotCollapse } from './useMascotCollapse';

// Pasek Fooli (fix/dialogue-polish) - WSZYSTKIE bloki poza SCENE_HOTSPOTS (tam Fooli "stoi" na scenie, floating
// nakładka: MascotOverlay.tsx). Gdzie indziej nakładka po prostu zasłaniała treść bloku (m.in. B-103 - dymek
// zachodził na pierwszy chip DIALOGUE) - ten komponent renderuje się W NORMALNYM PRZEPŁYWIE (nie
// position:absolute), więc NIC nie przesłania: PlayerStage.tsx go dokłada na górze panelu `'slide'`
// (EMAIL_ANALYSIS/ORDERING/TEXT_INPUT_GUIDED/EMBEDDED_HTML/TABS/NOTEPAD - wszystkie przez jedną, wspólną gałąź
// JSX-a), DialogueBlock.tsx renderuje TEN SAM komponent SAM (nad własnym nagłówkiem rozmowy, poza obszarem
// przewijania wątku - PlayerStage nie ma tam wystarczającej granulacji, patrz komentarz w PlayerStage.tsx).
//
// Ten sam stan zwijania co MascotOverlay.tsx (`useMascotCollapse`, WSPÓLNY hook - zero duplikacji zachowania: timer
// 8s, zwijanie na otwartą nakładkę/pierwszą interakcję z blokiem) - jedyna różnica to markup: rozwinięty stan to
// mała ikonka (32px, dużo mniejsza niż floating nakładka - pasek ma być "cienki") + tekst obok + X "Zwiń"; zwinięty
// stan to SAMA ikonka (32px), klikalna, żeby rozwinąć z powrotem. Tekst BEZ `line-clamp` (kod review - pierwsza
// wersja miała `line-clamp-2` + `max-h-16`, ucinającą dłuższe komunikaty treści BEZ żadnego sposobu ich rozwinięcia
// - czytnik ekranu i tak ogłaszałby cały tekst, osoba widząca nie miałaby jak go doczytać) - `max-h-[10rem]` niżej
// to wyłącznie techniczny limit animacji zwijania (patrz niżej), nie docelowy limit treści; komunikaty w treści
// kursu (`reactions.complete`/`reactions.result`, `packages/content`) są krótkie (pojedyncze zdanie), 10rem daje
// swobodny margines na zawijanie w wąskim pasku bez realnego ryzyka obcięcia.
// Zwijanie tekstu przez `max-h-0 opacity-0 overflow-hidden` (NIE `hidden`/`display:none`) - DOKŁADNIE ten
// sam wzorzec co MascotOverlay.tsx: `display:none` odmontowywałby `<p role="status">` z drzewa dostępności, a
// ponowne pojawienie się GOTOWEGO tekstu (zamiast aktualizacji istniejącego węzła) to dokładnie ten scenariusz, w
// którym czytniki ekranu często nie ogłaszają regionu aria-live (ten sam problem, który D-076 osobno naprawiał w
// SummaryScreen.tsx). `role="status" aria-live="polite"` na tym samym tekście co MascotOverlay.tsx -
// MascotOverlay/MascotBanner renderują się WZAJEMNIE WYKLUCZAJĄCO dla danego bloku (PlayerStage.tsx wybiera JEDNO z
// dwóch po contentLayout, DialogueBlock renderuje ten komponent TYLKO gdy PlayerStage nic nie renderuje dla 'fill'),
// więc nigdy nie ma dwóch żywych regionów ogłaszających to samo naraz.
export default function MascotBanner({ pose, text }: { pose?: string; text?: string }) {
  const { setCollapsed, bubbleVisible, rootRef } = useMascotCollapse({ pose, text });
  const bubbleId = useId();

  if (!pose) return null;

  return (
    <div ref={rootRef} data-testid="mascot-banner" className="mb-3 flex shrink-0 items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={text ? 'Fooli - pokaż wiadomość' : 'Fooli'}
        // `bubbleVisible` (NIE `!collapsed`, kod review) - `bubbleVisible` dodatkowo uwzględnia `anyOverlayOpen`
        // (patrz useMascotCollapse.ts): inaczej niż MascotOverlay.tsx (gdzie ikonka sama się chowa, gdy nakładka
        // jest otwarta), ikonka bannera zostaje klikalna nawet wtedy - `!collapsed` mówiłoby "rozwinięty" (true) w
        // chwili, gdy dymek jest wizualnie schowany z powodu otwartej nakładki, co rozjeżdżałoby się z tym, co
        // faktycznie widać.
        aria-expanded={text ? bubbleVisible : undefined}
        aria-controls={text ? bubbleId : undefined}
        className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-600"
      >
        <Mascot pose={pose} size={32} className="h-8 w-8" />
      </button>
      {text && (
        <div
          id={bubbleId}
          className={`flex min-w-0 flex-1 items-start justify-between gap-2 overflow-hidden transition-[max-height,opacity] duration-200 motion-reduce:transition-none ${
            bubbleVisible ? 'max-h-[10rem] opacity-100' : 'pointer-events-none max-h-0 opacity-0'
          }`}
        >
          <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
            {text}
          </p>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Zwiń wiadomość maskotki"
            tabIndex={bubbleVisible ? undefined : -1}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
