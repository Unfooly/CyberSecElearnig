import { useRef, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlayerStage from './PlayerStage';
import TranscriptPanel from './TranscriptPanel';
import { useOverlayLayer } from './overlay-stack';

// jsdom nie implementuje `inert` W OGÓLE (ani jako atrybut, ani jako blokada .focus()) - `restRef.current.inert =
// notesOpen` w PlayerStage.tsx staje się tam zwykłą, bezskutkową właściwością JS, więc `toHaveFocus()` przechodziłoby
// nawet z BŁĘDNĄ kolejnością efektów (kod review PR #44, druga runda: `useEffect` zamiast `useLayoutEffect` w
// PlayerStage.tsx wołał .inert PO tym, jak NotesDrawer.tsx próbował .focus() na wciąż-inertnym drzewie - w
// przeglądarce .focus() na elemencie inert jest no-opem, w jsdom nie robi żadnej różnicy). Ta symulacja odtwarza
// PRAWDZIWE zachowanie przeglądarki: .focus() jest no-opem, gdy jakikolwiek przodek ma (zwykłą) właściwość
// `.inert === true` - wystarczy, żeby test faktycznie wykrył wyścig, gdyby wrócił.
function hasInertAncestor(element: HTMLElement | null): boolean {
  for (let node = element; node; node = node.parentElement) {
    if ((node as unknown as { inert?: boolean }).inert) return true;
  }
  return false;
}

// Test na PRAWDZIWYM, zamontowanym PlayerStage (kod review PR #44 - dotychczasowe testy overlay-stack.tsx testują
// tylko sam rejestr, z ręcznie złożonymi warstwami-atrapami; ten plik sprawdza, że Escape w PlayerStage.tsx
// (jedyny document.addEventListener('keydown', ...) w całej ramce) naprawdę woła closeTop() i że warstwy
// zarejestrowane przez PRAWDZIWE komponenty potomne (tu: kartę hotspotu jako atrapę bloku SCENE_HOTSPOTS i
// prawdziwy NotesDrawer wewnątrz PlayerStage) kaskadują poprawnie - bez żadnego mostkowania/mockowania
// overlay-stack.tsx.

function HotspotCardStub() {
  const [open, setOpen] = useState(false);
  useOverlayLayer('hotspotCard', open, () => setOpen(false));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        otwórz kartę hotspotu
      </button>
      {open && (
        <div role="dialog" aria-label="Karta hotspotu">
          Treść karty
        </div>
      )}
    </>
  );
}

function Harness({ contentLayout, hint }: { contentLayout?: 'scene' | 'slide' | 'fill'; hint?: string } = {}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const transcriptTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <PlayerStage
      title="Sprawa testowa"
      blockNumber={1}
      totalBlocks={3}
      completedBlocks={0}
      stage={<HotspotCardStub />}
      contentLayout={contentLayout}
      hint={hint}
      narrationBar={null}
      transcriptPanel={<TranscriptPanel text="" open={false} onClose={() => {}} triggerRef={transcriptTriggerRef} />}
      notesCount={0}
      notesOpen={notesOpen}
      onToggleNotes={() => setNotesOpen((open) => !open)}
      notesId="notes-panel"
      onBack={() => {}}
      onForward={() => {}}
      canBack
      canForward
      headingRef={headingRef}
    />
  );
}

describe('PlayerStage: powrót fokusu z NotesDrawer musi wygrać wyścig z restRef.inert (kod review PR #44, druga runda)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fokus faktycznie ląduje na "Notatnik" (nie ginie na wciąż-inertnym drzewie) - symulowane .focus()/.inert jak w prawdziwej przeglądarce', () => {
    const originalFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (hasInertAncestor(this)) return;
      originalFocus.call(this, options);
    });

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Notatnik/ }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('button', { name: /^Notatnik/ })).toHaveFocus();
  });
});

describe('PlayerStage: kaskada Escape na PRAWDZIWYM, zamontowanym drzewie (bez mockowania overlay-stack)', () => {
  it('scenariusz z code review PR #44: karta hotspotu otwarta, potem notatnik NAD nią - Escape zamyka notatnik (fokus wraca na "Notatnik"), karta zostaje otwarta; drugi Escape zamyka kartę', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'otwórz kartę hotspotu' }));
    expect(screen.getByRole('dialog', { name: 'Karta hotspotu' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Notatnik/ }));
    // NotesDrawer jest prawdziwym modalem (aria-modal, focus trap) - otwarcie przenosi fokus na jego X.
    expect(screen.getByRole('button', { name: 'Zamknij notatnik' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    // Notatnik (otwarty PÓŹNIEJ) zamyka się jako pierwszy - LIFO, nie stały priorytet typu warstwy.
    // `getByRole(..., { name: 'Notatnik' })` NIE zadziałałby tutaj: dom-accessibility-api liczy nazwę dostępną
    // elementu aria-hidden="true" jako pustą niezależnie od aria-label (ten sam wzorzec co testy Topbar.tsx) -
    // trafiamy więc w dialog przez stały punkt odniesienia (przycisk X, zawsze w DOM) i sprawdzamy aria-hidden osobno.
    const notesDialog = screen.getByRole('button', { name: 'Zamknij notatnik', hidden: true }).closest('[role="dialog"]') as HTMLElement;
    expect(notesDialog).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: /^Notatnik/ })).toHaveFocus();
    // Karta hotspotu, otwarta WCZEŚNIEJ, zostaje otwarta.
    expect(screen.getByRole('dialog', { name: 'Karta hotspotu' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Karta hotspotu' })).not.toBeInTheDocument();
  });

  it('Escape bez żadnej otwartej warstwy nic nie robi (closeTop() zwraca false, nic nie wybucha)', () => {
    render(<Harness />);

    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
  });
});

describe('PlayerStage: podpowiedź - nakładka TYLKO na SCENE_HOTSPOTS, pasek na "slide", nic na "fill" (D-093, dawniej Fooli)', () => {
  it("contentLayout='scene': nakładka obecna, pasek nieobecny; bez obrazka postaci", () => {
    render(<Harness contentLayout="scene" hint="Rozejrzyj się." />);
    expect(screen.getByTestId('hint-overlay')).toHaveTextContent('Rozejrzyj się.');
    expect(screen.queryByTestId('hint-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /maskotka/i })).not.toBeInTheDocument();
  });

  it("contentLayout='slide': pasek obecny, nakładka nieobecna", () => {
    render(<Harness contentLayout="slide" hint="Sprawdź nadawcę." />);
    expect(screen.getByTestId('hint-bar')).toHaveTextContent('Sprawdź nadawcę.');
    expect(screen.queryByTestId('hint-overlay')).not.toBeInTheDocument();
  });

  it("contentLayout='fill' (DIALOGUE): PlayerStage NIE renderuje ani nakładki, ani paska - DialogueBlock.tsx renderuje własny pasek", () => {
    render(<Harness contentLayout="fill" hint="Rozmawiaj dalej." />);
    expect(screen.queryByTestId('hint-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hint-bar')).not.toBeInTheDocument();
  });

  it('bez hint (undefined) nic się nie renderuje, niezależnie od contentLayout', () => {
    render(<Harness contentLayout="scene" />);
    expect(screen.queryByTestId('hint-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hint-bar')).not.toBeInTheDocument();
  });
});

describe('PlayerStage: przycisk „Wstecz” w wąskim pasku (D-097)', () => {
  function BackHarness({ backLabel }: { backLabel?: string }) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    return (
      <PlayerStage
        title="Sprawa testowa"
        blockNumber={1}
        totalBlocks={1}
        completedBlocks={0}
        stage={<p>blok</p>}
        narrationBar={null}
        transcriptPanel={null}
        notesCount={0}
        notesOpen={false}
        onToggleNotes={() => {}}
        notesId="notes-panel"
        onBack={() => {}}
        onForward={() => {}}
        canBack
        canForward
        backLabel={backLabel}
        headingRef={headingRef}
      />
    );
  }

  it('domyślne „Wstecz”: przycisk-ikona (pbar-icon), tekst tylko dla czytnika (pbar-label)', () => {
    render(<BackHarness />);
    const back = screen.getByRole('button', { name: 'Wstecz' });
    expect(back.className).toMatch(/\bpbar-icon\b/);
    expect(back.querySelector('.pbar-label')).toHaveTextContent('Wstecz');
  });

  it('inna etykieta (SUMMARY „Rozpocznij od nowa”): tekst widoczny (pbar-text, bez pbar-label) - sam chevron sugerowałby cofnięcie', () => {
    render(<BackHarness backLabel="Rozpocznij od nowa" />);
    const back = screen.getByRole('button', { name: 'Rozpocznij od nowa' });
    expect(back.className).toMatch(/\bpbar-text\b/);
    expect(back.className).not.toMatch(/\bpbar-icon\b/);
    expect(back.querySelector('.pbar-label')).toBeNull();
    expect(back).toHaveTextContent('Rozpocznij od nowa');
  });
});

// Regresja realnie złapana w CoursePlayer.exploratory.test.tsx ("Wstecz z niezapisanego bloku i powrót"): dodanie
// warunkowego paska (dawniej `{mascot && <MascotBanner/>}`) jako NOWEGO slotu PRZED `{stage}` w gałęzi 'slide' - podczas gdy
// gałąź 'scene'/'fill' miała `{stage}` jako JEDYNE dziecko - przesuwało `stage` z indeksu 0 na indeks 1 w tablicy
// dzieci w chwili, gdy `contentLayout` zmieniał się między 'scene' i 'slide' (np. CoursePlayer.tsx: "Wstecz" na
// blok INNEGO typu niż żywy blok liczy contentLayout z PODGLĄDANEGO bloku, nie żywego). React reconciluje dzieci
// WEDŁUG POZYCJI - przesunięcie slotu odmontowywało CAŁE poddrzewo `stage` (żywy, ukryty blok włącznie, MIMO
// własnego `key`), tracąc jego wewnętrzny stan. Naprawka: JEDEN <div> z DWOMA STAŁYMI slotami (banner zawsze
// pierwszy, `stage` zawsze drugi) - ten test pilnuje, żeby `stage` NIGDY nie remontował się przy zmianie
// contentLayout, niezależnie od tego, czy dzieje się to razem ze zmianą obecności `hint` (jak w produkcji).
describe('PlayerStage: {stage} NIE remontuje się przy zmianie contentLayout (fix/dialogue-polish, regresja ze slotu paska przesuwającego pozycję {stage} w tablicy dzieci)', () => {
  function StatefulStage() {
    const [clicks, setClicks] = useState(0);
    return (
      <button type="button" onClick={() => setClicks((c) => c + 1)}>
        Klik: {clicks}
      </button>
    );
  }

  function ContentLayoutHarness({ contentLayout, hint }: { contentLayout: 'scene' | 'slide' | 'fill'; hint?: string }) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    return (
      <PlayerStage
        title="Sprawa testowa"
        blockNumber={1}
        totalBlocks={1}
        completedBlocks={0}
        stage={<StatefulStage />}
        contentLayout={contentLayout}
        hint={hint}
        narrationBar={null}
        transcriptPanel={null}
        notesCount={0}
        notesOpen={false}
        onToggleNotes={() => {}}
        notesId="notes-panel"
        onBack={() => {}}
        onForward={() => {}}
        canBack
        canForward
        headingRef={headingRef}
      />
    );
  }

  it('przejście "scene" (z hint) -> "slide" (bez hint) - jak "Wstecz" z żywego SCENE_HOTSPOTS na podgląd bloku innego typu bez podpowiedzi - zachowuje stan {stage}', () => {
    const { rerender } = render(<ContentLayoutHarness contentLayout="scene" hint="Rozejrzyj się." />);
    fireEvent.click(screen.getByRole('button', { name: /Klik/ }));
    expect(screen.getByRole('button', { name: 'Klik: 1' })).toBeInTheDocument();

    rerender(<ContentLayoutHarness contentLayout="slide" hint={undefined} />);

    expect(screen.getByRole('button', { name: 'Klik: 1' })).toBeInTheDocument();
  });

  it('przejście "slide" -> "scene", oba z hint - zachowuje stan {stage}', () => {
    const { rerender } = render(<ContentLayoutHarness contentLayout="slide" hint="A" />);
    fireEvent.click(screen.getByRole('button', { name: /Klik/ }));

    rerender(<ContentLayoutHarness contentLayout="scene" hint="B" />);

    expect(screen.getByRole('button', { name: 'Klik: 1' })).toBeInTheDocument();
  });

  it('przejście "fill" -> "slide" (z hint) - zachowuje stan {stage}', () => {
    const { rerender } = render(<ContentLayoutHarness contentLayout="fill" hint="A" />);
    fireEvent.click(screen.getByRole('button', { name: /Klik/ }));

    rerender(<ContentLayoutHarness contentLayout="slide" hint="B" />);

    expect(screen.getByRole('button', { name: 'Klik: 1' })).toBeInTheDocument();
  });
});
