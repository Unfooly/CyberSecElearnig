import { useEffect } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ExploratoryBlock from './ExploratoryBlock';
import { computeHotspotCentroid, hotspotStackZIndex, NOT_EVIDENCE_TOAST } from './SceneHotspotsBlock';
import { typingDelayMs } from './DialogueBlock';
import { NotesProvider, NotesPanel, useNotes } from '../player/notes';
import { EvidenceCounter, EvidenceProvider, useEvidence } from '../player/evidence';
import { HINT_EVENT_TEXT, HintProvider, useHints } from '../player/hints';
import { OverlayStackProvider, useCloseTopOverlay } from '../player/overlay-stack';
import type { ContentBlock, EvidenceSummary } from '@/lib/courses-types';

// Karta hotspotu rejestruje swój Escape w overlay-stack (feat/player-stage) zamiast WŁASNEGO
// document.addEventListener - w produkcji PlayerStage ma jeden nasłuch Escape na całą ramkę i woła closeTop(); ten
// most odtwarza DOKŁADNIE to samo okablowanie w izolowanym renderze tego pliku (bez prawdziwego PlayerStage).
function EscapeCascadeBridge() {
  const closeTop = useCloseTopOverlay();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTop();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeTop]);
  return null;
}

// Mechaniki "śledztwa": dowody, hotspoty z kartą, dialog po jednej kwestii, rozwiązanie sprawy.

const scene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'scena',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    {
      id: 'h1',
      label: 'Monitor',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      content: 'Kartka z hasłem.',
      required: true,
      evidence: true,
      note: { text: 'Hasło na kartce.', kind: 'item' },
    },
    { id: 'h2', label: 'Drzwi', x: 50, y: 50, width: 20, height: 20, content: 'Drzwi bez zamka.', required: false },
    {
      id: 'h3',
      label: 'Kubek',
      x: 70,
      y: 10,
      width: 10,
      height: 10,
      content: 'Zwykły kubek.',
      required: false,
      evidence: true,
      note: { text: 'Kubek z logo firmy.', kind: 'place' },
    },
  ],
};

const dialogue: ContentBlock = {
  type: 'DIALOGUE',
  id: 'rozmowa',
  title: 'Rozmowa z Anną',
  character: { name: 'Anna', role: 'Księgowa', avatar: 'img/anna.png' },
  questions: [
    {
      id: 'q1',
      text: 'Skąd ten mail?',
      lines: [{ text: 'Przyszedł rano.' }, { text: 'Wyglądał jak od banku.' }, { text: 'Kliknęłam w link.' }],
      note: { text: 'Mail przyszedł rano.', kind: 'mail' },
      evidence: true,
      required: true,
    },
    { id: 'q2', text: 'Kto go wysłał?', answer: 'Nie znam nadawcy.', required: false, note: { text: 'Nieznany nadawca.', kind: 'person' } },
  ],
};

function Probe() {
  const { notes } = useNotes();
  const { hint } = useHints();
  return (
    <>
      <output data-testid="notes">{notes.map((n) => `${n.kind ?? '-'}:${n.text}`).join('|')}</output>
      <output data-testid="reaction">{hint ?? ''}</output>
    </>
  );
}

// "Dalej" żyje w pasku powłoki (CoursePlayer), nie w bloku - blok zgłasza gotowość przez onReady (funkcja submit albo
// null). `ready` to referencja na ostatnio zgłoszoną funkcję; testy "klikają Dalej" wywołując ready.current().
function setup(
  block: ContentBlock,
  options: {
    review?: boolean;
    summary?: EvidenceSummary;
    titles?: Record<string, string>;
    onSubmit?: (a?: unknown) => void;
    myAvatarUrl?: string | null;
    myInitials?: string;
  } = {},
) {
  const onSubmit = options.onSubmit ?? vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  render(
    <OverlayStackProvider>
      <EscapeCascadeBridge />
      <NotesProvider initial={[]} blockTitles={options.titles ?? { scena: 'Biuro', rozmowa: 'Rozmowa z Anną' }}>
        <EvidenceProvider summary={options.summary}>
          <HintProvider resetKey="k">
            <EvidenceCounter />
            <ExploratoryBlock
              block={block}
              contentBase="/content"
              onSubmit={onSubmit}
              onReady={(submit) => {
                ready.current = submit;
              }}
              disabled={false}
              review={options.review}
              myAvatarUrl={options.myAvatarUrl}
              myInitials={options.myInitials}
            />
            <Probe />
            <NotesPanel id="panel" />
          </HintProvider>
        </EvidenceProvider>
      </NotesProvider>
    </OverlayStackProvider>,
  );
  return { onSubmit, ready };
}

// Zbliżenie przedmiotu (D-086): klik w punkt na obrazie (w pełni dostępny: aria-label, focus-ring) - kamera przybliża scenę, na
// niej nakładka role="dialog" z grafiką zbliżenia i przyciskami "Zabierz"/"Odłóż"; dowód zalicza WYŁĄCZNIE "Zabierz".
// Testy komponentu idą z prefers-reduced-motion (bez ruchu kamery nakładka jest od razu otwarta - synchronicznie); ścieżka z
// animacją (450/350 ms) ma osobny test z fałszywym zegarem.
const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const dialog = () => screen.getByRole('dialog');
const putDown = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Odłóż' }));
const takeIt = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Zabierz' }));
const back = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Wróć' }));

function stubMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function withReducedMotion() {
  let restore = () => {};
  beforeEach(() => {
    restore = stubMotion(true);
  });
  afterEach(() => restore());
}

describe('SCENE_HOTSPOTS: punkty, zbliżenie i dowody', () => {
  withReducedMotion();
  const summary: EvidenceSummary = { collected: 0, total: 2, perBlock: [{ blockId: 'scena', collected: 0, total: 2 }] };

  it('puls-podpowiedź do pierwszego kliknięcia: potem nakładki są niewidoczne, odkryta ma znacznik', () => {
    setup(scene, { summary });
    expect(screen.getByTestId('hotspot-overlay-h1')).toHaveAttribute('data-state', 'hint');
    expect(screen.getByTestId('hotspot-overlay-h1').className).toContain('motion-safe:animate-pulse');
    expect(screen.getByTestId('hotspot-overlay-h1').className).not.toMatch(/(^|\s)animate-pulse/); // animacja tylko bez prefers-reduced-motion

    pick('Monitor');
    expect(screen.getByTestId('hotspot-overlay-h1')).toHaveAttribute('data-state', 'discovered');
    expect(screen.getByTestId('hotspot-overlay-h2')).toHaveAttribute('data-state', 'hidden');
    expect(screen.getByTestId('hotspot-overlay-h2').className).not.toContain('animate-pulse');
  });

  it('punkty na obrazie są w pełni dostępne: bez aria-hidden/tabIndex=-1, z aria-label i widocznym focus-ringiem - jedyna ścieżka (bez chipów)', () => {
    setup(scene, { summary });
    const overlay = screen.getByTestId('hotspot-overlay-h1');
    expect(overlay).not.toHaveAttribute('aria-hidden');
    expect(overlay).not.toHaveAttribute('tabindex', '-1');
    expect(overlay).toHaveAttribute('aria-label', 'Monitor');
    expect(overlay.className).toMatch(/focus-visible:outline/);
    expect(screen.queryByRole('list', { name: 'Elementy sceny' })).not.toBeInTheDocument();
  });

  it('data-zoom-open (D-101): przy otwartym zbliżeniu punkty i podpowiedź panoramy pod nim schowane (globals.css, opacity), po Odłóż - z powrotem i fokus na przedmiocie', () => {
    setup(scene, { summary });
    const hotspot = screen.getByTestId('hotspot-overlay-h1');
    fireEvent.click(hotspot);
    const view = dialog().parentElement!;
    expect(view).toHaveAttribute('data-zoom-open');
    putDown();
    expect(view).not.toHaveAttribute('data-zoom-open');
    expect(hotspot).toHaveFocus();
  });

  it('zbliżenie leży NA scenie (role=dialog, aria-label = nazwa przedmiotu), scena przyciemniona ink 35% + blur 3 px (D-102), bez białej karty i bez bloków tekstu; punkty i obraz pod nim dostają aria-hidden', () => {
    setup(scene, { summary });
    fireEvent.click(screen.getByTestId('hotspot-overlay-h1'));

    expect(dialog()).toHaveAttribute('aria-label', 'Monitor');
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(dialog().className).toMatch(/bg-ink\/35/);
    expect(dialog().className).toMatch(/backdrop-blur-\[3px\]/);
    // Odłóż ghost (jasny tekst i obrys) na ciemniejszym wypełnieniu - kontrast na scenie przyciemnionej tylko w 35%.
    expect(within(dialog()).getByRole('button', { name: 'Odłóż' }).className).toMatch(/text-white.*bg-ink\/50|bg-ink\/50.*text-white/);
    expect(dialog().querySelector('.hotspot-card, .bg-white, h3')).toBeNull();
    expect(within(dialog()).getByTestId('scene-zoom-graphic').className).toMatch(/max-h-\[88%\]/);

    // Punkt 5 (feat/scene-overlay-fix): nakładka jest "absolute" (przypięta DO KONTENERA obrazu), NIGDY "fixed"
    // (przypięta do viewportu) - inaczej na mobile zasłaniałaby licznik "Obejrzano X z Y", który jest NAD obrazem,
    // poza kontenerem sceny. Sprawdzone też strukturalnie: licznik nie jest potomkiem nakładki.
    expect(dialog().className).toMatch(/(^|\s)absolute(\s|$)/);
    expect(dialog().className).not.toMatch(/(^|\s)fixed(\s|$)/);
    const counter = screen.getByText('Wszystko obejrzane.'); // done >= total po kliknięciu jedynego required (h1)
    expect(dialog().contains(counter)).toBe(false);

    const covered = screen.getByTestId('hotspot-overlay-h2'); // "Drzwi" - inny hotspot na tej samej scenie, zasłonięty
    expect(covered).toHaveAttribute('aria-hidden', 'true');
    expect(covered).toHaveAttribute('tabindex', '-1');

    // Code review po commicie 367743b: samo ukrycie przycisków nie wystarczy - obraz sceny pod nimi (z niepustym alt)
    // musi też dostać aria-hidden, inaczej czytnik ekranu w trybie przeglądania (virtual cursor) i tak "wejdzie" na
    // jego opis mimo otwartego role="dialog" aria-modal="true".
    expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('aria-hidden', 'true');

    putDown();
    expect(screen.getByTestId('hotspot-overlay-h2')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('img')).not.toHaveAttribute('aria-hidden');
  });

  it('błąd wczytania OBRAZU (poprawna ścieżka, np. 404 z CDN - onError, nie zła ścieżka od startu) chowa punkty: bez chipów jako zapasowej ścieżki są teraz nieosiągalne (code review: to inny warunek niż "zła ścieżka", oba muszą działać)', () => {
    setup(scene, { summary });
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monitor' })).toBeInTheDocument();
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Monitor' })).not.toBeInTheDocument();
  });

  it('klik w punkt otwiera zbliżenie z fokusem na "Zabierz"; "Zabierz" zalicza dowód (notatnik z ikoną rodzaju, licznik, podpowiedź), odkłada przedmiot i oddaje fokus; ponowne otwarcie: tylko "Odłóż" i "W notatniku"', () => {
    const { onSubmit, ready } = setup(scene, { summary });
    const trigger = screen.getByTestId('hotspot-overlay-h1');
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Zabierz' }));
    // Treść przedmiotu bez grafiki (fixture bez media) - opis w ciemnym panelu zamiast pustego zbliżenia.
    expect(dialog()).toHaveTextContent('Kartka z hasłem.');

    takeIt();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Hasło na kartce.');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getByTestId('reaction')).toHaveTextContent(HINT_EVENT_TEXT.evidence);

    // Panel notatnika: grupa z nazwą sceny, ikona (etykieta) rodzaju.
    const panel = screen.getByRole('complementary', { name: 'Notatnik' });
    expect(within(panel).getByRole('region', { name: 'Biuro' })).toHaveTextContent('Przedmiot: Hasło na kartce.');

    fireEvent.click(trigger);
    expect(within(dialog()).queryByRole('button', { name: 'Zabierz' })).not.toBeInTheDocument();
    expect(within(dialog()).getByText('W notatniku')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Odłóż' }));
    putDown();

    pick('Drzwi'); // wymagany tylko Monitor
    putDown();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['h1', 'h2'], noted: ['h1'] });
  });

  it('klik w tło (poza grafiką i przyciskami) = "Odłóż"; focus trap: Tab z ostatniego przycisku wraca na pierwszy', () => {
    setup(scene, { summary });
    const trigger = screen.getByTestId('hotspot-overlay-h1');
    fireEvent.click(trigger);
    const take = within(dialog()).getByRole('button', { name: 'Zabierz' });
    const put = within(dialog()).getByRole('button', { name: 'Odłóż' });
    put.focus();
    fireEvent.keyDown(put, { key: 'Tab' });
    expect(document.activeElement).toBe(take);
    fireEvent.keyDown(take, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(put);

    fireEvent.click(within(dialog()).getByText('Kartka z hasłem.')); // klik w samą treść nie zamyka
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(dialog());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('"Zabierz" przy przedmiocie, który nie jest dowodem: potrząśnięcie i toast, bez notatki i bez zamknięcia', () => {
    setup(scene, { summary });
    pick('Drzwi');
    takeIt();
    expect(within(dialog()).getByRole('status')).toHaveTextContent(NOT_EVIDENCE_TOAST);
    expect(within(dialog()).getByRole('button', { name: 'Zabierz' }).className).toMatch(/scene-zoom-shake/);
    // Przycisk jest montowany od nowa (restart animacji) - fokus zostaje na nim, w nakładce.
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Zabierz' }));
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/2');
  });

  it('Escape = "Odłóż" (zamyka zbliżenie, oddaje fokus przyciskowi, który je otworzył)', () => {
    setup(scene, { summary });
    const trigger = screen.getByTestId('hotspot-overlay-h1');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('ukończenie po wymaganych (required), nie po wszystkich: opcjonalne punkty ("smaczki") nie blokują', () => {
    const { onSubmit, ready } = setup(scene, { summary });
    expect(screen.getByText('Obejrzano 0 z 1 elementów.')).toBeInTheDocument();
    expect(ready.current).toBeNull();
    pick('Monitor');
    putDown();
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['h1'], noted: [] });
  });

  it('podgląd: brak "Zabierz", brak zmian w notatniku i liczniku', () => {
    setup(scene, { summary, review: true });
    pick('Monitor');
    expect(within(dialog()).queryByRole('button', { name: 'Zabierz' })).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/2');
  });
});

const mediaScene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'scena-media',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    {
      id: 'obraz',
      label: 'Zdjęcie',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      content: 'Zbliżenie na kartkę.',
      media: { kind: 'image', src: 'img/kartka-zoom.png', alt: 'Zbliżenie karteczki z hasłem' },
      evidence: true,
      note: { text: 'Hasło widoczne na zbliżeniu.', kind: 'item' },
    },
    {
      id: 'audio',
      label: 'Telefon',
      x: 40,
      y: 10,
      width: 20,
      height: 20,
      content: 'Prawdziwy bank nigdy nie prosi o kod SMS przez telefon.',
      media: { kind: 'audio', audioUrl: 'audio/poczta-glosowa.mp3', transcript: 'Dzień dobry, dzwonię z banku.', image: 'img/telefon-zoom.png' },
      evidence: true,
      note: { text: 'Telefon z podejrzaną prośbą o kod SMS.', kind: 'item' },
    },
    {
      id: 'dokument',
      label: 'Drukarka',
      x: 70,
      y: 10,
      width: 20,
      height: 20,
      content: 'Wydruk przelewu.',
      media: { kind: 'document', title: 'Potwierdzenie przelewu', lines: ['Kwota: 14 000,00 PLN', 'Odbiorca: Wektor Rozliczenia'] },
    },
    // Drugi hotspot audio WYŁĄCZNIE po to, żeby przetestować key={hotspot.id} na AudioMedia (code review commitu
    // 1ff5939): stan (playing) między dwoma RÓŻNYMI hotspotami audio nie może "przeciekać".
    {
      id: 'radio',
      label: 'Radio',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      content: 'Radio gra w tle.',
      media: { kind: 'audio', audioUrl: 'audio/radio.mp3', transcript: 'Muzyka w tle.' },
    },
    // Transkrypcja bez audioUrl (druga runda code review, punkt 7): plik audio się nie wczytał/nie ma go w treści,
    // ale transkrypcja - tekstowa alternatywa - musi zostać dostępna niezależnie.
    {
      id: 'dyktafon',
      label: 'Zepsuty dyktafon',
      x: 60,
      y: 40,
      width: 15,
      height: 15,
      content: 'Dyktafon nie działa.',
      media: { kind: 'audio', transcript: 'Zapisana rozmowa z klientem.' },
    },
  ],
};

// Bug na produkcji: hotspot "karteczka" (mały, PIERWSZY w tablicy) jest geometrycznie zagnieżdżony w hotspocie
// "monitor" (duży, DRUGI w tablicy, jak w prawdziwej treści modułu 1) - bez jawnego z-index klik w część wspólną
// trafiał w "monitor" (renderowany później w DOM = na wierzchu), nie w "karteczkę".
const overlappingScene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'zagniezdzone-geometrycznie',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    { id: 'karteczka', label: 'Mała karteczka', x: 20, y: 20, width: 8, height: 8, content: 'Mała, w środku dużego.' },
    { id: 'monitor', label: 'Duży monitor', x: 10, y: 10, width: 30, height: 30, content: 'Duży, obejmuje karteczkę.' },
  ],
};

// To samo co overlappingScene, ale ZAGNIEŻDŻONE (media.kind: 'scene') - code review PR #36: pierwsza wersja testowała
// wyłącznie scenę najwyższego poziomu, więc regresja WYŁĄCZNIE w NestedSceneImage (drugie miejsce stosujące
// hotspotStackZIndex) nie miałaby żadnego testu.
const overlappingNestedScene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'zagniezdzone-w-scenie',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    {
      id: 'monitor',
      label: 'Monitor',
      x: 10,
      y: 10,
      width: 30,
      height: 30,
      content: 'Ekran z pulpitem.',
      media: {
        kind: 'scene',
        scene: {
          image: 'scenes/pulpit.png',
          imageAlt: 'Pulpit',
          hotspots: [
            { id: 'mala-ikona', label: 'Mała ikona', x: 20, y: 20, width: 8, height: 8, content: 'Mała, w środku dużego.' },
            { id: 'duzy-folder', label: 'Duży folder', x: 10, y: 10, width: 30, height: 30, content: 'Duży, obejmuje ikonę.' },
          ],
        },
      },
    },
  ],
};

describe('SCENE_HOTSPOTS: łańcuch wysokości (hotfix fix/player-scene-fit/B-100 - scena ma się ZAWSZE zmieścić w całości, bez przewijania obszaru bloku; produkcja: pasek przewijania w obszarze bloku, bo scena była wyższa niż dostępne miejsce)', () => {
  function renderScene() {
    return render(
      <OverlayStackProvider>
        <EscapeCascadeBridge />
        <NotesProvider initial={[]} blockTitles={{ scena: 'Biuro' }}>
          <EvidenceProvider summary={undefined}>
            <HintProvider resetKey="k">
              <ExploratoryBlock block={scene} contentBase="/content" onSubmit={vi.fn()} onReady={vi.fn()} disabled={false} />
            </HintProvider>
          </EvidenceProvider>
        </NotesProvider>
      </OverlayStackProvider>,
    );
  }

  it('korzeń przekazuje pełną wysokość w dół: shrink-0 na nagłówku, flex-1 min-h-0 + [container-type:size] na kontenerze obrazu', () => {
    const { container } = renderScene();

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bflex\b/);
    expect(root.className).toMatch(/min-h-0/);
    expect(root.className).toMatch(/w-full/);
    expect(root.className).toMatch(/flex-1/);
    expect(root.className).toMatch(/flex-col/);

    const header = root.firstElementChild as HTMLElement;
    expect(header.className).toMatch(/shrink-0/);

    const imageArea = header.nextElementSibling as HTMLElement;
    expect(imageArea.className).toMatch(/flex/);
    expect(imageArea.className).toMatch(/min-h-0/);
    expect(imageArea.className).toMatch(/flex-1/);
    expect(imageArea.className).toMatch(/items-center/);
    expect(imageArea.className).toMatch(/justify-center/);
    // Kontener zapytań rozmiaru MUSI być TUTAJ (po flex-1 min-h-0 - a więc PO odjęciu wysokości nagłówka przez
    // flexbox), nie na komórce bloku w PlayerStage.tsx - inaczej cqw/cqh liczyłyby się względem WIĘKSZEJ komórki
    // sprzed odjęcia nagłówka i scena mogłaby wyjść wyższa niż realnie dostępne miejsce.
    expect(imageArea.className).toMatch(/\[container-type:size\]/);
  });

  it('kontener sceny (kwadrat aspect-ratio): rozmiar formułą CSS "contain" z jednostek cqw/cqh, bez max-h-full/max-w-full i bez JS (ResizeObserver)', () => {
    const { container } = renderScene();

    const root = container.firstElementChild as HTMLElement;
    const imageArea = root.firstElementChild!.nextElementSibling as HTMLElement;
    // ScenePanContainer (feat/player-portrait) owija sizowaną skrzynkę DWOMA divami - .scene-pan-frame (zewnętrzny,
    // nieprzewijany - punkt odniesienia dla cieni/podpowiedzi) i .scene-pan-container (wewnętrzny, przewijany).
    const panFrame = imageArea.firstElementChild as HTMLElement;
    const panContainer = panFrame.firstElementChild as HTMLElement;
    const aspectBox = panContainer.firstElementChild as HTMLElement;

    expect(panFrame.className).toBe('scene-pan-frame');
    expect(panContainer.className).toBe('scene-pan-container');
    expect(aspectBox.className).not.toMatch(/max-h-full/);
    expect(aspectBox.className).not.toMatch(/max-w-full/);
    // Formuła szerokości ("contain"/"fit-height" na telefonie w pionie) jest KLASĄ .scene-box (globals.css), NIE
    // inline style (feat/player-portrait - inline style nie dałoby się nadpisać z @media bez !important, ten sam
    // wzorzec co .player-frame) - stąd .style.width jest tu puste, sprawdzamy samą klasę.
    expect(aspectBox.className).toMatch(/\bscene-box\b/);
    expect(aspectBox.style.width).toBe('');
    expect(aspectBox.style.height).toBe('auto');
    expect(aspectBox.style.aspectRatio).toBe('var(--scene-ratio)');
    expect(aspectBox.style.margin).toBe('auto');
    // --scene-ratio pochodzi z wymiarów obrazu (domyślnie 16/10 do czasu załadowania prawdziwego pliku - fixtures
    // testowe nie mają realnych plików, więc to zawsze domyślna wartość tutaj).
    expect(aspectBox.style.getPropertyValue('--scene-ratio')).toBe(String(16 / 10));
  });
});

describe('SCENE_HOTSPOTS: kolejność stackowania nakładających się hotspotów', () => {
  withReducedMotion();
  it('hotspotStackZIndex (czysta funkcja): remis dostaje kolejność z tablicy, pojedynczy element i pusta tablica nie wywalają', () => {
    const tie = hotspotStackZIndex([
      { id: 'a', width: 10, height: 10 },
      { id: 'b', width: 10, height: 10 }, // dokładnie to samo pole co "a"
    ]);
    expect(tie.get('b')).toBeGreaterThan(tie.get('a')!); // stabilny sort: PÓŹNIEJSZY w tablicy wygrywa remis (jak dawniej DOM)

    expect(hotspotStackZIndex([{ id: 'jedyny', width: 5, height: 5 }]).get('jedyny')).toBe(1);
    expect(hotspotStackZIndex([]).size).toBe(0);
  });

  it('mniejszy hotspot dostaje WYŻSZY z-index niż większy, mimo że jest PRZED nim w DOM (kolejność DOM/Tab zostaje jak w treści)', () => {
    setup(overlappingScene);
    const karteczka = screen.getByTestId('hotspot-overlay-karteczka');
    const monitor = screen.getByTestId('hotspot-overlay-monitor');

    expect(Number(karteczka.style.zIndex)).toBeGreaterThan(Number(monitor.style.zIndex));

    const buttons = [...document.querySelectorAll('[data-testid^="hotspot-overlay-"]')];
    expect(buttons.indexOf(karteczka)).toBeLessThan(buttons.indexOf(monitor)); // Tab: nadal w kolejności treści
  });

  it('to samo WEWNĄTRZ zagnieżdżonej sceny (NestedSceneImage - drugie miejsce stosujące hotspotStackZIndex)', () => {
    setup(overlappingNestedScene);
    fireEvent.click(screen.getByTestId('hotspot-overlay-monitor'));
    const mala = within(dialog()).getByRole('button', { name: 'Mała ikona' });
    const duzy = within(dialog()).getByRole('button', { name: 'Duży folder' });
    expect(Number(mala.style.zIndex)).toBeGreaterThan(Number(duzy.style.zIndex));
  });

  it('kontener sceny ma isolate (code review PR #36): bez WŁASNEGO kontekstu stackowania z-index 1..20 hotspotów konkurowałby z ROOT kontekstem strony - np. z lepkim dolnym paskiem "Wstecz/Dalej" (PlayerShell.tsx, sticky bez z-index), który hotspot mógłby przykryć i przechwycić mu kliknięcia po przewinięciu', () => {
    setup(overlappingScene);
    expect(screen.getByRole('img').parentElement).toHaveClass('isolate');
  });

  // Sanity check identyfikacji (jsdom nie ma prawdziwego layoutu/hit-testingu po współrzędnych, więc to NIE jest
  // dowód poprawnego stackowania - ten jest w teście wyżej, przez wartości z-index; prawdziwy klik po współrzędnych
  // w miejsce wspólne obu prostokątów wymaga przeglądarki, np. scripts/e2e-module-01.mjs, którego domyślny
  // Playwright .click() odrzuciłby klik na "karteczkę" zasłonięte przez "monitor" - stąd ten bug w ogóle dotarł na
  // produkcję: skrypt e2e nie dało się dotąd uruchomić lokalnie, B-085).
  it('klik we WŁASNY przycisk "karteczki" otwiera jej kartę (identyfikacja per-hotspot nie miesza się z "monitor")', () => {
    setup(overlappingScene);
    fireEvent.click(screen.getByTestId('hotspot-overlay-karteczka'));
    expect(dialog()).toHaveAttribute('aria-label', 'Mała karteczka');
  });
});

describe('SCENE_HOTSPOTS: ruch kamery (bez prefers-reduced-motion)', () => {
  afterEach(() => vi.useRealTimers());

  it('przybliżenie 450 ms (transform na pudełku sceny, fazy in -> open), grafika i przyciski dopiero po dojechaniu; "Odłóż" oddala 350 ms i dopiero wtedy zamyka', () => {
    vi.useFakeTimers();
    setup(scene);
    const box = screen.getByRole('img').parentElement!;
    fireEvent.click(screen.getByTestId('hotspot-overlay-h1'));
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'in');
    expect(box.style.transition).toContain('450ms');
    expect(box.style.transform).toMatch(/scale\(/);
    expect(screen.queryByTestId('scene-zoom-actions')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'open');
    expect(within(dialog()).getByRole('button', { name: 'Zabierz' })).toBeInTheDocument();

    putDown();
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'out');
    // Przyciemnienie (D-102) znika razem z kamerą.
    expect(screen.getByTestId('scene-zoom').className).toMatch(/bg-transparent/);
    expect(screen.getByTestId('scene-zoom').className).not.toMatch(/bg-ink\/35/);
    expect(box.style.transition).toContain('350ms');
    expect(box.style.transform).toBe('');
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('podwójny klik w przedmiot nie zamyka zbliżenia; drugi "Odłóż"/Esc w trakcie oddalania nic nie psuje; stary timer nie skraca ponownego otwarcia', () => {
    vi.useFakeTimers();
    setup(scene);
    const trigger = screen.getByTestId('hotspot-overlay-h1');
    fireEvent.click(trigger);
    // Drugi klik serii trafia już w nakładkę (faza "in") - ignorowany.
    fireEvent.click(screen.getByTestId('scene-zoom-graphic'));
    fireEvent.click(dialog());
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'in');
    act(() => vi.advanceTimersByTime(450));

    putDown();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'out');
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);

    // Otwarcie -> Esc w fazie "in" -> natychmiastowe ponowne otwarcie: timer pierwszego zamknięcia nie zamyka drugiego zbliżenia.
    // (fireEvent klika przedmiot pod nakładką - w przeglądarce niemożliwe; test pilnuje licznika generacji, nie ścieżki gracza.)
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'in');
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'open');
  });

  it('scena zagnieżdżona: przedmioty pulpitu nieaktywne, dopóki kamera nie dojedzie na monitor', () => {
    vi.useFakeTimers();
    setup(nestedScene);
    fireEvent.click(screen.getByTestId('hotspot-overlay-monitor'));
    const outlook = screen.getByTestId('hotspot-overlay-outlook');
    expect(outlook).toHaveAttribute('aria-hidden', 'true');
    expect(outlook.className).toMatch(/pointer-events-none/);
    fireEvent.click(outlook);
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'in');

    act(() => vi.advanceTimersByTime(450));
    fireEvent.click(screen.getByTestId('hotspot-overlay-outlook'));
    // Ekran (D-104): klik w ikonę pulpitu NIE rusza kamerą - okno od razu otwarte, bez transformu pudełka pulpitu.
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'inner-open');
    expect(document.querySelector<HTMLElement>('.hotspot-nested-scene-box')!.style.transform).toBe('');
    // Okno nad przyciemnionym pulpitem (D-102/D-104), max 94% sceny.
    const graphic = screen.getByTestId('scene-zoom-graphic');
    const innerLayer = graphic.parentElement!;
    expect(innerLayer.className).toMatch(/bg-ink\/35/);
    expect(graphic.className).toMatch(/max-h-\[94%\]/);
    // Zamknięcie też bez oddalania - od razu pulpit, fokus na ikonie.
    putDown();
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'open');
    expect(screen.getByTestId('hotspot-overlay-outlook')).toHaveFocus();
  });

  it('prefers-reduced-motion: bez ruchu kamery (brak transform i transition), zbliżenie od razu otwarte', () => {
    const restore = stubMotion(true);
    try {
      setup(scene);
      const box = screen.getByRole('img').parentElement!;
      fireEvent.click(screen.getByTestId('hotspot-overlay-h1'));
      expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'open');
      expect(box.style.transform).toBe('');
      expect(box.style.transition).toBe('');
    } finally {
      restore();
    }
  });
});

describe('SCENE_HOTSPOTS: panorama telefonu w pionie (feat/player-portrait)', () => {
  withReducedMotion();
  // afterEach (nie tylko na końcu każdego testu z osobna) - kod review: nieudana asercja W ŚRODKU testu zostawiała
  // podmienionego navigator dla KOLEJNYCH testów (odsłonięty vi.unstubAllGlobals() na końcu testu nigdy by się nie
  // wykonał, gdyby expect() wcześniej rzucił).
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computeHotspotCentroid (czysta funkcja): średnia środków x% hotspotów, 0..1; pusta lista -> 0.5 (środek)', () => {
    expect(computeHotspotCentroid([])).toBe(0.5);
    // Jeden hotspot: centroid = jego własny środek (x + width/2), przeskalowany na 0..1.
    expect(computeHotspotCentroid([{ x: 10, width: 20 }])).toBeCloseTo(0.2); // środek 20% -> 0.2
    // Dwa hotspoty po przeciwnych stronach - średnia ich środków.
    expect(computeHotspotCentroid([{ x: 0, width: 10 }, { x: 90, width: 10 }])).toBeCloseTo(0.5); // środki 5% i 95% -> 0.5
    // Wynik zawsze w [0,1] - defensywnie, nawet dla danych poza zwykłym zakresem 0..100.
    expect(computeHotspotCentroid([{ x: 200, width: 10 }])).toBe(1);
    expect(computeHotspotCentroid([{ x: -50, width: 10 }])).toBe(0);
  });

  it('otwarcie hotspotu woła navigator.vibrate (informacja dotykowa) - feature-detected, nie wywala się bez API', () => {
    const vibrateSpy = vi.fn();
    // { vibrate: spy }, NIE { ...window.navigator, vibrate: spy } (kod review) - właściwości navigator są getterami
    // na prototypie, spread ich nie kopiuje (nic by nie skopiował poza tym, co i tak nadpisujemy).
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    setup(scene);
    fireEvent.click(screen.getByTestId('hotspot-overlay-h1'));
    expect(vibrateSpy).toHaveBeenCalledWith(10);
  });

  it('otwarcie hotspotu WEWNĄTRZ zagnieżdżonej sceny też woła navigator.vibrate', () => {
    const vibrateSpy = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    setup(nestedScene);
    fireEvent.click(screen.getByTestId('hotspot-overlay-monitor'));
    vibrateSpy.mockClear(); // otwarcie zewnętrznego hotspotu już woła raz - liczy się TYLKO drugie, zagnieżdżone
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    expect(vibrateSpy).toHaveBeenCalledWith(10);
  });
});

describe('SCENE_HOTSPOTS: grafika zbliżenia (image/audio/document, B-086/D-071)', () => {
  withReducedMotion();
  // Własny odtwarzacz audio (feat/scene-overlay-fix) próbuje .play() przy otwarciu karty (autoodtwarzanie po geście
  // kliknięcia) - jsdom nie implementuje HTMLMediaElement.play() (zwraca undefined, nie odrzucony Promise), więc bez
  // mocka rzuca "Not implemented" (ten sam wzorzec co NarrationPlayer.test.tsx).
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // imagePortrait (D-104): wariant pionowy tylko, gdy widok sceny jest węższy niż 0.8 wysokości. Mock rozmiaru sprząta afterEach.
  const stageSize = (width: number, height: number) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect);
  const withPortraitImage: ContentBlock = {
    ...mediaScene,
    hotspots: mediaScene.hotspots!.map((h) => (h.media?.kind === 'image' ? { ...h, media: { ...h.media, imagePortrait: 'img/zdjecie-pion.png' } } : h)),
  };
  const zoomSrc = () => within(dialog()).getByAltText('Zbliżenie karteczki z hasłem').getAttribute('src');

  it('imagePortrait (D-104): telefon w pionie (widok sceny < 0.8) - wariant pionowy', () => {
    stageSize(360, 600);
    setup(withPortraitImage);
    pick('Zdjęcie');
    expect(zoomSrc()).toContain('zdjecie-pion.png');
  });

  it('imagePortrait (D-104): poziomo - zwykła grafika (src), mimo wariantu pionowego', () => {
    stageSize(1280, 720);
    setup(withPortraitImage);
    pick('Zdjęcie');
    expect(zoomSrc()).toContain('kartka-zoom.png');
    expect(zoomSrc()).not.toContain('pion');
  });

  it('imagePortrait (D-104): pionowo bez wariantu pionowego - zwykła grafika (src)', () => {
    stageSize(360, 600);
    setup(mediaScene);
    pick('Zdjęcie');
    expect(zoomSrc()).toContain('kartka-zoom.png');
  });

  it('imagePortrait (D-104): okno na ekranie (poziom 2, pulpit) w pionie - wariant pionowy', () => {
    stageSize(360, 600);
    const monitor = nestedScene.hotspots![0];
    const media = monitor.media!;
    const portraitNested: ContentBlock = {
      ...nestedScene,
      hotspots: [
        {
          ...monitor,
          media: {
            ...media,
            scene: {
              ...media.scene!,
              hotspots: media.scene!.hotspots.map((h) => (h.id === 'outlook' && h.media?.kind === 'image' ? { ...h, media: { ...h.media, imagePortrait: 'img/mail-pion.png' } } : h)),
            },
          },
        },
        ...nestedScene.hotspots!.slice(1),
      ],
    };
    setup(portraitNested);
    fireEvent.click(screen.getByTestId('hotspot-overlay-monitor'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    expect(within(dialog()).getByAltText('Podgląd maila').getAttribute('src')).toContain('mail-pion.png');
  });

  it('image: sama grafika (object-contain, cień, max 88%) - bez tekstu przedmiotu (content) i bez tytułu', () => {
    setup(mediaScene);
    pick('Zdjęcie');
    const img = within(dialog()).getByAltText('Zbliżenie karteczki z hasłem');
    expect(img.className).toMatch(/object-contain/);
    // Cień po kształcie przezroczystej grafiki (drop-shadow), nie prostokątny cień karty (D-101).
    expect(img.className).toMatch(/\bzoom-shadow\b/);
    expect(img.className).not.toMatch(/shadow-card|rounded/);
    expect(img.className).toMatch(/max-w-\[88%\]/);
    expect(within(dialog()).queryByText('Zbliżenie na kartkę.')).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('heading')).not.toBeInTheDocument();
  });

  it('document: tytuł i linie w ciemnym panelu z własnym przewijaniem (<pre> overflow-auto)', () => {
    setup(mediaScene);
    pick('Drukarka');
    expect(within(dialog()).getByText('Potwierdzenie przelewu')).toBeInTheDocument();
    const pre = within(dialog()).getByText(/Kwota: 14 000,00 PLN/).closest('pre')!;
    expect(pre.className).toMatch(/overflow-auto/);
    expect(pre.className).toMatch(/min-h-0/);
  });

  it('audio: zbliżenie (media.image) i play/pauza pod nim (bez natywnych controls, autoodtwarzanie po kliku), transkrypcja ZASTĘPUJE obrazek', () => {
    setup(mediaScene);
    pick('Telefon');

    expect(screen.queryByText(/Prawdziwy bank nigdy nie prosi/)).not.toBeInTheDocument();
    expect(within(dialog()).getByAltText('')).toHaveAttribute('src', expect.stringContaining('telefon-zoom.png')); // zbliżenie z media.image

    const audioEl = document.querySelector('audio')!;
    expect(audioEl).toBeInTheDocument();
    expect(audioEl).not.toHaveAttribute('controls'); // własny odtwarzacz, nie natywny <audio controls> (feedback z produkcji)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled(); // klik hotspotu = gest użytkownika -> autoplay

    expect(within(dialog()).getByRole('button', { name: 'Odtwórz nagranie' })).toBeInTheDocument(); // play() zmockowany, onPlay się nie odpala - stan startowy

    // Stała etykieta "Transkrypcja" + aria-pressed (druga runda code review, punkt 6) - nie "Pokaż/Ukryj"/aria-expanded.
    const toggle = screen.getByRole('button', { name: 'Transkrypcja' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Własne ciemne tło (kontrast białego tekstu na scenie przyciemnionej tylko w 35%, D-102).
    expect(toggle.className).toMatch(/bg-ink\/80/);
    expect(screen.queryByText('Dzień dobry, dzwonię z banku.')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    // Widok się ZAMIENIŁ: transkrypcja w miejscu obrazka, obrazek zniknął, przycisk play/pauza zostaje.
    // Region z transkrypcją jest dostępny i przewijalny samodzielnie (role=region, tabIndex=0), nie tylko widoczny.
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const transcriptRegion = screen.getByRole('region', { name: 'Transkrypcja' });
    expect(transcriptRegion).toHaveAttribute('tabindex', '0');
    expect(within(transcriptRegion).getByText('Dzień dobry, dzwonię z banku.')).toBeVisible();
    expect(within(dialog()).queryByAltText('')).not.toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Odtwórz nagranie' })).toBeInTheDocument();

    // Kliknięcie ponownie wraca do zbliżenia (zamiana widoku w drugą stronę), nie dokłada transkrypcji pod nim.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog()).getByAltText('')).toHaveAttribute('src', expect.stringContaining('telefon-zoom.png'));
    expect(screen.queryByRole('region', { name: 'Transkrypcja' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dzień dobry, dzwonię z banku.')).not.toBeInTheDocument();
  });

  it('audio: przycisk play/pauza przełącza odtwarzanie i etykietę ("Odtwórz nagranie"/"Wstrzymaj nagranie" - fix/dialogue-polish, bez paska postępu/czasu)', () => {
    setup(mediaScene);
    pick('Telefon');
    const audioEl = document.querySelector('audio')!;

    Object.defineProperty(audioEl, 'paused', { value: false, configurable: true }); // jsdom nie synchronizuje .paused z play()/pause() zmockowanymi wyżej
    fireEvent(audioEl, new Event('play'));
    expect(within(dialog()).getByRole('button', { name: 'Wstrzymaj nagranie' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Wstrzymaj nagranie' }));
    expect(audioEl.pause).toHaveBeenCalled();
  });

  it('audio: fix/dialogue-polish - po zakończeniu nagrania (ended) przycisk wraca do "Odtwórz nagranie", klik odtwarza od początku (currentTime resetowany na 0)', () => {
    setup(mediaScene);
    pick('Telefon');
    const audioEl = document.querySelector('audio')!;
    Object.defineProperty(audioEl, 'paused', { value: true, configurable: true });
    Object.defineProperty(audioEl, 'ended', { value: true, configurable: true });
    Object.defineProperty(audioEl, 'currentTime', { value: 30, configurable: true, writable: true });
    fireEvent(audioEl, new Event('ended'));

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Odtwórz nagranie' }));

    expect(audioEl.currentTime).toBe(0);
  });

  it('audio: stan (playing) nie przecieka między dwoma RÓŻNYMI hotspotami audio - key={hotspot.id} wymusza remount', () => {
    setup(mediaScene);
    pick('Telefon');
    const firstAudio = document.querySelector('audio')!;
    Object.defineProperty(firstAudio, 'paused', { value: false, configurable: true });
    fireEvent(firstAudio, new Event('play'));
    expect(within(dialog()).getByRole('button', { name: 'Wstrzymaj nagranie' })).toBeInTheDocument();

    putDown();
    pick('Radio');
    const secondAudio = document.querySelector('audio')!;
    expect(secondAudio).not.toBe(firstAudio); // inny <audio> - świeży <AudioMedia>, nie ta sama instancja
    expect(within(dialog()).getByRole('button', { name: 'Odtwórz nagranie' })).toBeInTheDocument(); // stan playing zresetowany
  });

  it('audio: przeglądarka odrzuca play() (autoplay zablokowany) - przycisk zostaje "Odtwórz nagranie", bez komunikatu błędu i bez wywalenia komponentu', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    setup(mediaScene);
    pick('Telefon');
    expect(within(dialog()).getByRole('button', { name: 'Odtwórz nagranie' })).toBeInTheDocument();
    expect(screen.queryByText(/autoodtwarzanie|zablokował/i)).not.toBeInTheDocument(); // celowo BEZ komunikatu (inaczej niż NarrationPlayer.tsx)
  });

  it('audio: dowód WYMAGA "Zabierz" - samo otwarcie (ani odsłuchanie) nie wystarcza (D-071)', () => {
    setup(mediaScene);
    pick('Telefon');
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    fireEvent(document.querySelector('audio')!, new Event('ended')); // odsłuchanie samo z siebie też nie zalicza dowodu
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    takeIt();
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Telefon z podejrzaną prośbą o kod SMS.');
  });

  it('audio: transkrypcja działa NIEZALEŻNIE od audioUrl - dostępna i klikalna nawet, gdy plik audio się nie wczytał/nie ma go w treści (druga runda code review, punkt 7 - regresja pierwszej wersji tego hotfixu: przycisk transkrypcji stawał się "martwy", bo widok transkrypcji był zagnieżdżony w tym samym warunku co odtwarzacz)', () => {
    setup(mediaScene);
    pick('Zepsuty dyktafon');

    expect(document.querySelector('audio')).not.toBeInTheDocument(); // brak audioUrl -> brak elementu <audio>
    expect(screen.queryByRole('button', { name: 'Odtwórz nagranie' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Transkrypcja' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('region', { name: 'Transkrypcja' })).getByText('Zapisana rozmowa z klientem.')).toBeVisible();
  });

  it('audio z potoku TTS (media.narration, D-082): odtwarza narration.audioUrl, transkrypcją jest narration.text', () => {
    const tts: ContentBlock = {
      ...mediaScene,
      hotspots: mediaScene.hotspots!.map((hotspot) =>
        hotspot.id === 'audio'
          ? { ...hotspot, media: { kind: 'audio', narration: { text: 'Dzień dobry, tu bank Wektor.', audioUrl: 'audio/m/v1/b/0123456789abcdef.mp3', durationMs: 1000 }, image: 'img/telefon-zoom.png' } }
          : hotspot,
      ),
    };
    setup(tts);
    pick('Telefon');
    expect(document.querySelector('audio')!.getAttribute('src')).toContain('audio/m/v1/b/0123456789abcdef.mp3');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Transkrypcja' }));
    expect(within(screen.getByRole('region', { name: 'Transkrypcja' })).getByText('Dzień dobry, tu bank Wektor.')).toBeVisible();
  });

  it('image: dowód też wymaga "Zabierz", tak samo jak audio (spójne dla wszystkich mediów)', () => {
    setup(mediaScene);
    pick('Zdjęcie');
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    takeIt();
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Hasło widoczne na zbliżeniu.');
  });
});

const nestedScene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'scena-zagniezdzona',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    {
      id: 'monitor',
      label: 'Monitor',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      content: 'Ekran z otwartym pulpitem.',
      media: {
        kind: 'scene',
        scene: {
          image: 'scenes/pulpit.png',
          imageAlt: 'Pulpit komputera',
          hotspots: [
            {
              id: 'outlook',
              label: 'Outlook',
              x: 5,
              y: 5,
              width: 15,
              height: 15,
              content: 'Program pocztowy.',
              media: { kind: 'image', src: 'img/mail.png', alt: 'Podgląd maila' },
              evidence: true,
              note: { text: 'Mail otwarty w programie pocztowym.', kind: 'mail' },
            },
            { id: 'kosz', label: 'Kosz', x: 30, y: 5, width: 15, height: 15, content: 'Pusty kosz.' },
          ],
        },
      },
    },
    { id: 'kubek', label: 'Kubek', x: 70, y: 10, width: 10, height: 10, content: 'Zwykły kubek.' },
  ],
};

describe('SCENE_HOTSPOTS: zagnieżdżona mini-scena (media.kind:"scene", B-086/D-071)', () => {
  withReducedMotion();

  it('klik na hotspot z media.kind:"scene": zbliżenie przechodzi w scenę zagnieżdżoną z klikalnymi punktami i ikoną "Wróć" - bez "Zabierz"/"Odłóż"', () => {
    setup(nestedScene);
    pick('Monitor');
    expect(within(dialog()).getByAltText('Pulpit komputera')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Outlook' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Kosz' })).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Wróć' }));
    expect(within(dialog()).queryByRole('button', { name: 'Zabierz' })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Odłóż' })).not.toBeInTheDocument();
  });

  it('scena zagnieżdżona ma formułę "contain" (.hotspot-nested-scene-frame z container-type:size, .hotspot-nested-scene-box z cqw/cqh w globals.css), bez max-h-full/max-w-full', () => {
    setup(nestedScene);
    pick('Monitor');
    const img = within(dialog()).getByAltText('Pulpit komputera');
    const aspectBox = img.parentElement!;
    const queryContainer = aspectBox.parentElement!;

    expect(queryContainer.className).toMatch(/(^|\s)hotspot-nested-scene-frame(\s|$)/);
    expect(aspectBox.className).toMatch(/(^|\s)hotspot-nested-scene-box(\s|$)/);
    expect(aspectBox.className).not.toMatch(/max-h-full/);
    expect(aspectBox.className).not.toMatch(/max-w-full/);
    expect(aspectBox.style.width).toBe('');
    expect(aspectBox.style.height).toBe('auto');
    expect(aspectBox.style.aspectRatio).toBe('var(--scene-ratio)');
    expect(aspectBox.style.margin).toBe('auto');
    // Fixture testowa nie ma prawdziwego pliku obrazu - domyślne 16/10 do czasu (nigdy nadchodzącego tu) onLoad.
    expect(aspectBox.style.getPropertyValue('--scene-ratio')).toBe(String(16 / 10));
    expect(img.className).toMatch(/object-contain/);
  });

  it('scena zagnieżdżona: --scene-ratio się aktualizuje po wczytaniu obrazu (onLoad), nie zostaje na domyślnym 16/10 (druga runda code review, punkt 10 - test wykrywa zerwane okablowanie efektu/onLoad, nie tylko nazwy klas)', () => {
    setup(nestedScene);
    pick('Monitor');
    const img = within(dialog()).getByAltText('Pulpit komputera') as HTMLImageElement;
    const aspectBox = img.parentElement!;
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 500, configurable: true });

    fireEvent.load(img);

    expect(aspectBox.style.getPropertyValue('--scene-ratio')).toBe(String(800 / 500));
    expect(aspectBox.style.aspectRatio).toBe('var(--scene-ratio)');
  });

  it('scena zagnieżdżona: obraz już wczytany z cache PRZY MONTOWANIU (img.complete - React 18 nie odtwarza `load` dla tego przypadku, React #15446) też aktualizuje --scene-ratio, bez czekania na onLoad', () => {
    // try/finally (nie tylko vi.restoreAllMocks() na końcu testu): bez tego nieudana asercja zostawiłaby zmockowane
    // complete/naturalWidth/naturalHeight na prototypie HTMLImageElement, przeciekając do KOLEJNYCH testów w tym pliku.
    try {
      vi.spyOn(window.HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
      vi.spyOn(window.HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400);
      vi.spyOn(window.HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(200);

      setup(nestedScene);
      pick('Monitor');
      const img = within(dialog()).getByAltText('Pulpit komputera');
      const aspectBox = img.parentElement!;

      expect(aspectBox.style.getPropertyValue('--scene-ratio')).toBe(String(400 / 200));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('klik na element WEWNĄTRZ zagnieżdżonej sceny otwiera jego zbliżenie (drugi poziom TEJ SAMEJ nakładki); dowód wymaga "Zabierz"', () => {
    setup(nestedScene);
    pick('Monitor');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));

    expect(dialog()).toHaveAttribute('aria-label', 'Outlook');
    expect(screen.getByAltText('Podgląd maila')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    takeIt();
    expect(screen.getByTestId('notes')).toHaveTextContent('mail:Mail otwarty w programie pocztowym.');
    // "Zabierz" odkłada TYLKO przedmiot - pulpit zostaje otwarty.
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Monitor');
  });

  it('"Odłóż" z poziomu maila cofa do pulpitu (nakładka zostaje otwarta), "Wróć" z pulpitu zamyka nakładkę', () => {
    setup(nestedScene);
    pick('Monitor');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    expect(dialog()).toHaveAttribute('aria-label', 'Outlook');

    putDown(); // z maila -> pulpit
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Monitor');
    // Outlook już odwiedzony: dostępna nazwa ma teraz sufiks " (obejrzane)", fokus wraca na niego.
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Outlook (obejrzane)' }));

    back(); // z pulpitu -> zamyka
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Escape zdejmuje jeden poziom naraz: z maila do pulpitu, dopiero drugi Escape zamyka nakładkę', () => {
    setup(nestedScene);
    pick('Monitor');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Outlook (obejrzane)' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('visited/noted wysłane do serwera zawierają id z WEWNĄTRZ zagnieżdżonej sceny (spłaszczone, D-071)', () => {
    const { onSubmit, ready } = setup(nestedScene);
    pick('Monitor');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    takeIt(); // mail -> pulpit
    // Wszystkie wymagane (żaden hotspot nie ma jawnego required -> fallback "wszystkie"): monitor, outlook, kosz, kubek.
    expect(ready.current).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Kosz' }));
    expect(ready.current).toBeNull(); // kubek (zewnętrzny) jeszcze nieodwiedzony
    putDown(); // kosz -> pulpit
    back(); // pulpit -> zamyka nakładkę całkowicie
    pick('Kubek');
    putDown();
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: expect.arrayContaining(['monitor', 'outlook', 'kosz', 'kubek']), noted: ['outlook'] });
  });

  it('licznik "Obejrzano X z Y" liczy Y ze spłaszczonego zbioru (4: monitor, outlook, kosz, kubek)', () => {
    setup(nestedScene);
    expect(screen.getByText('Obejrzano 0 z 4 elementów.')).toBeInTheDocument();
  });

  it('zamknięcie i ponowne otwarcie zewnętrznego hotspotu resetuje wybór wewnątrz JEGO zagnieżdżonej sceny', () => {
    setup(nestedScene);
    pick('Monitor');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    expect(dialog()).toHaveAttribute('aria-label', 'Outlook');
    fireEvent.keyDown(document, { key: 'Escape' });
    back(); // zamyka nakładkę całkowicie

    // Monitor już odwiedzony: dostępna nazwa ma teraz sufiks " (obejrzane)".
    fireEvent.click(screen.getByRole('button', { name: 'Monitor (obejrzane)' }));
    expect(dialog()).toHaveAttribute('aria-label', 'Monitor');
    expect(within(dialog()).getByRole('button', { name: 'Outlook (obejrzane)' })).toBeInTheDocument();
  });
});

// Easter egg (D-100): ikona gry na pulpicie (hotspot z media.kind "popups" WEWNĄTRZ zagnieżdżonej sceny).
const easterScene: ContentBlock = {
  ...nestedScene,
  hotspots: nestedScene.hotspots!.map((hotspot) =>
    hotspot.id === 'monitor'
      ? {
          ...hotspot,
          media: {
            ...hotspot.media!,
            scene: {
              ...hotspot.media!.scene!,
              hotspots: [
                ...hotspot.media!.scene!.hotspots,
                {
                  id: 'gra',
                  label: 'GTA6_PL.exe',
                  x: 50,
                  y: 5,
                  width: 15,
                  height: 15,
                  content: 'Ikona gry.',
                  media: {
                    kind: 'popups' as const,
                    items: [
                      { title: 'Wykryto 147 wirusów!', body: 'Twój komputer jest bardzo chory.', button: 'Wylecz za 0 zł', behavior: 'dodge' as const },
                      { title: 'Gratulacje!', body: 'Wygrałeś smartfon!', button: 'Odbierz nagrodę' },
                    ],
                    outro: 'Pirackie gry to częsta droga wirusów do firm.',
                    badge: { id: 'ciekawski-detektyw', label: 'Curious Detective' },
                  },
                  required: false,
                },
              ],
            },
          },
        }
      : hotspot,
  ),
};

describe('SCENE_HOTSPOTS: okienka easter egga (media.kind "popups", D-100)', () => {
  withReducedMotion();
  const openGame = () => {
    pick('Monitor');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'GTA6_PL.exe' }));
  };
  const closePopup = (title: string) => fireEvent.click(screen.getByRole('button', { name: `Zamknij okienko: ${title}` }));

  it('okienka zamiast zbliżenia (bez Zabierz/Odłóż); przedmiot NIE jest obejrzany, dopóki okienka są otwarte', () => {
    setup(easterScene);
    openGame();
    expect(screen.getAllByTestId('easter-popup')).toHaveLength(2);
    // Okienka wprost na pulpicie (D-104): bez przyciemnienia pod nimi.
    expect(screen.getByTestId('easter-popups').parentElement!.className).not.toMatch(/bg-ink/);
    expect(screen.queryByRole('button', { name: 'Zabierz' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Odłóż' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('notebook-distinctions')).not.toBeInTheDocument();
    // Ikona pod okienkami (aria-hidden - nazwy dostępnej nie da się policzyć, stąd atrybut) nie ma sufiksu „(obejrzane)”, także po
    // zamknięciu części okienek.
    closePopup('Gratulacje!');
    expect(document.querySelector('[aria-label="GTA6_PL.exe"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="GTA6_PL.exe (obejrzane)"]')).toBeNull();
  });

  it('okienka na przedmiocie SCENY GŁÓWNEJ: po wszystkich - outro z „Wróć” (bez pulpitu), zamyka nakładkę, przedmiot obejrzany', () => {
    const outerScene: ContentBlock = {
      ...nestedScene,
      hotspots: [
        ...nestedScene.hotspots!,
        {
          id: 'laptop',
          label: 'Laptop',
          x: 40,
          y: 40,
          width: 10,
          height: 10,
          content: 'Laptop.',
          media: { kind: 'popups' as const, items: [{ title: 'Gratulacje!', body: 'Wygrałeś smartfon!', button: 'Odbierz nagrodę' }], outro: 'To tylko ćwiczenie.' },
        },
      ],
    };
    setup(outerScene);
    pick('Laptop');
    closePopup('Gratulacje!');
    expect(screen.getByTestId('easter-outro')).toHaveTextContent('To tylko ćwiczenie.');
    expect(screen.queryByTestId('easter-badge')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wróć' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Laptop (obejrzane)' })).toBeInTheDocument();
  });

  it('Esc zamyka górne okienko (nie cały pulpit), klik w tło nie zamyka niczego', () => {
    setup(easterScene);
    openGame();
    fireEvent.click(screen.getByTestId('scene-zoom'));
    expect(screen.getAllByTestId('easter-popup')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByTestId('easter-popup')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Gratulacje!' })).not.toBeInTheDocument();
  });

  it('po zamknięciu wszystkich: outro, wyróżnienie w notatniku (bez notatki i dowodu), ikona obejrzana; do serwera idzie w visited', () => {
    const { onSubmit, ready } = setup(easterScene);
    openGame();
    closePopup('Gratulacje!');
    closePopup('Wykryto 147 wirusów!');
    expect(screen.getByTestId('easter-outro')).toHaveTextContent('Pirackie gry');
    // Pierwsze znalezienie: „Nowe” mimo że onFound już dopisał osiągnięcie do notatnika (stan zamrożony przy otwarciu).
    expect(screen.getByTestId('easter-badge')).toHaveTextContent(/^Nowe osiągnięcie: Curious Detective$/);
    expect(screen.getByTestId('notebook-distinctions')).toHaveTextContent('Curious Detective');
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Wróć do pulpitu' }));
    expect(within(dialog()).getByRole('button', { name: 'GTA6_PL.exe (obejrzane)' })).toBeInTheDocument();
    // Ukończenie bloku: gra NIE jest wymagana (required: false i okienka poza pulą) - reszta tak.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Outlook' }));
    putDown();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Kosz' }));
    putDown();
    back();
    pick('Kubek');
    putDown();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: expect.arrayContaining(['monitor', 'gra', 'outlook', 'kosz', 'kubek']), noted: [] });
  });

  it('easter egg nie jest wymagany: blok gotowy bez niego, licznik „Obejrzano” go nie liczy', () => {
    const { ready } = setup(easterScene);
    expect(screen.getByText('Obejrzano 0 z 4 elementów.')).toBeInTheDocument();
    pick('Monitor');
    for (const name of ['Outlook', 'Kosz']) {
      fireEvent.click(within(dialog()).getByRole('button', { name }));
      putDown();
    }
    back();
    pick('Kubek');
    putDown();
    expect(ready.current).not.toBeNull();
  });

  it('w podglądzie ukończonego bloku (review) wyróżnienie nie trafia do notatnika', () => {
    setup(easterScene, { review: true });
    openGame();
    closePopup('Gratulacje!');
    closePopup('Wykryto 147 wirusów!');
    expect(screen.queryByTestId('notebook-distinctions')).not.toBeInTheDocument();
  });
});

const doorScene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'korytarz',
  title: 'Korytarz',
  image: 'scenes/korytarz.png',
  imageAlt: 'Korytarz',
  hotspots: [
    {
      id: 'dowod',
      label: 'Kartka',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      content: 'Coś ciekawego.',
      required: true,
      evidence: true,
      note: { text: 'Dowód w korytarzu.', kind: 'item' },
    },
    { id: 'drzwi', label: 'Wyjście', x: 90, y: 10, width: 8, height: 10, action: 'next' },
  ],
};

describe('SCENE_HOTSPOTS: "drzwi" (action: "next", B-086/D-071)', () => {
  withReducedMotion();
  it('nieaktywne dopóki required nie zebrane: aria-disabled, tooltip/aria-label z licznikiem, klik nic nie robi (jedyny przycisk - bez osobnej listy)', () => {
    const { onSubmit } = setup(doorScene);
    const door = screen.getByRole('button', { name: /Wyjście: zbierz najpierw dowody \(0\/1\)/ });
    expect(door).toHaveAttribute('aria-disabled', 'true');
    expect(door).toHaveAttribute('title', 'Zbierz najpierw dowody: 0/1');
    fireEvent.click(door);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('po zebraniu required: klik w drzwi NIE nawiguje, tylko zgłasza gotowość - zapis rusza „Dalej” w pasku (D-106); bez nakładki', () => {
    const { onSubmit, ready } = setup(doorScene);
    pick('Kartka');
    putDown();
    const door = screen.getByRole('button', { name: 'Wyjście' });
    expect(door).toHaveAttribute('aria-disabled', 'false');
    expect(door).not.toHaveAttribute('title');
    expect(ready.current).toBeNull();
    fireEvent.click(door);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['dowod'], noted: [] });
    // Drzwi same nigdy nie otwierają nakładki (w odróżnieniu od zwykłego hotspotu) - klik w nie nie ustawia activeId.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blok z drzwiami nie zgłasza gotowości przed podejściem do drzwi - nawet po zebraniu required', () => {
    const { ready } = setup(doorScene);
    expect(ready.current).toBeNull();
    pick('Kartka');
    expect(ready.current).toBeNull();
  });
});

// Rozmowa jak w komunikatorze (feat/dialogue-chat, D-087): po pytaniu rozmówca "pisze" (typingDelayMs), potem przychodzi jego kwestia;
// każda kwestia z własnym pisaniem. Fałszywy zegar: typeNext() przesuwa czas o maksymalne opóźnienie (2200 ms) - jedna kwestia.
const typeNext = () =>
  act(() => {
    vi.advanceTimersByTime(2200);
  });
const typeAll = (count = 8) => {
  for (let i = 0; i < count; i += 1) typeNext();
};

describe('DIALOGUE: komunikator (pisanie, kwestie po jednej)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('typingDelayMs: clamp(500 + 18 ms × znaki, 700, 2200); reduced-motion 300 ms', () => {
    expect(typingDelayMs('ab')).toBe(700);
    expect(typingDelayMs('x'.repeat(50))).toBe(1400);
    expect(typingDelayMs('x'.repeat(500))).toBe(2200);
    expect(typingDelayMs('x'.repeat(500), true)).toBe(300);
  });

  it('pytanie: dymek gracza od razu, potem "pisze" i kwestie po kolei (każda z własnym pisaniem); pytanie liczy się po ostatniej - notatka, dowód, chip znika; bez "Następna kwestia"', () => {
    const { onSubmit, ready } = setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));

    expect(within(screen.getByRole('log')).getByText('Skąd ten mail?')).toBeInTheDocument();
    expect(screen.getByTestId('dialogue-typing')).toBeInTheDocument();
    expect(screen.queryByText('Przyszedł rano.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Następna kwestia' })).not.toBeInTheDocument();
    // Kliknięty chip znika od razu z listy (jest w wątku).
    expect(within(screen.getByRole('list', { name: 'Pytania do zadania' })).queryByRole('button', { name: /Skąd ten mail/ })).not.toBeInTheDocument();
    expect(ready.current).toBeNull();
    expect(screen.getByText('Zadano 0 z 1 pytań.')).toBeInTheDocument();

    typeNext();
    expect(screen.getByText('Przyszedł rano.')).toBeInTheDocument();
    expect(screen.queryByText('Wyglądał jak od banku.')).not.toBeInTheDocument();
    expect(screen.getByTestId('dialogue-typing')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');

    typeNext();
    expect(screen.getByText('Wyglądał jak od banku.')).toBeInTheDocument();
    typeNext();
    expect(screen.getByText('Kliknęłam w link.')).toBeInTheDocument();
    expect(screen.queryByTestId('dialogue-typing')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('mail:Mail przyszedł rano.');
    expect(screen.getByTestId('reaction')).toHaveTextContent(HINT_EVENT_TEXT.evidence);
    expect(screen.getByText('Wszystkie wymagane pytania zadane.')).toBeInTheDocument();

    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1'] });
  });

  it('gdy rozmówca pisze, pozostałe pytania są nieaktywne (klik nic nie robi), po odpowiedzi znów dostępne; odpowiedź bez lines to jedna kwestia', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    const other = screen.getByRole('button', { name: 'Kto go wysłał?' });
    expect(other).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(other);
    expect(within(screen.getByRole('log')).queryByText('Kto go wysłał?')).not.toBeInTheDocument();

    typeAll(3);
    expect(screen.getByRole('button', { name: 'Kto go wysłał?' })).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    typeNext();
    expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('person:Nieznany nadawca.');
  });

  it('klik we wskaźnik pisania albo Spacja = kwestia od razu, bez czekania', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    fireEvent.click(screen.getByTestId('dialogue-typing'));
    expect(screen.getByText('Przyszedł rano.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('log'), { key: ' ' });
    expect(screen.getByText('Wyglądał jak od banku.')).toBeInTheDocument();
  });

  it('Spacja, która pokazała ostatnią kwestię, nie zadaje kolejnego pytania (chip dostaje fokus, jego aktywacja do keyup zablokowana); przytrzymana Spacja nic nie robi', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    fireEvent.keyDown(screen.getByRole('log'), { key: ' ' });
    expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const chip = screen.getByRole('button', { name: 'Skąd ten mail?' });
    expect(chip).toHaveFocus();
    fireEvent.keyDown(chip, { key: ' ', repeat: true });
    fireEvent.click(chip);
    expect(within(screen.getByRole('log')).queryByText('Skąd ten mail?')).not.toBeInTheDocument();
    fireEvent.keyUp(chip, { key: ' ' });
    fireEvent.click(chip);
    expect(within(screen.getByRole('log')).getByText('Skąd ten mail?')).toBeInTheDocument();
  });

  it('prefers-reduced-motion: statyczne „pisze…” i kwestia po 300 ms', () => {
    const restore = stubMotion(true);
    try {
      setup(dialogue);
      fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
      expect(screen.getByTestId('dialogue-typing')).toHaveTextContent('pisze…');
      expect(screen.getByTestId('dialogue-typing').querySelector('.chat-typing-dot')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(screen.queryByText('Nie znam nadawcy.')).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('autoprzewijanie także wtedy, gdy wskaźnik pisania zamienia się w kwestię (ta sama liczba wiadomości)', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true });
    const scrollTo = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    expect(scrollTo).toHaveBeenCalled();
    scrollTo.mockClear();
    typeNext(); // [pytanie, pisze] -> [pytanie, kwestia]
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('kwestia otwierająca też jest "pisana"; chipy nieaktywne, dopóki nie przyjdzie', () => {
    setup({ ...dialogue, character: { ...dialogue.character!, opening: 'Ja naprawdę nic nie zrobiłam.' } });
    expect(screen.getByTestId('dialogue-typing')).toBeInTheDocument();
    expect(screen.queryByText('Ja naprawdę nic nie zrobiłam.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skąd ten mail?' })).toHaveAttribute('aria-disabled', 'true');
    typeNext();
    expect(screen.getByText('Ja naprawdę nic nie zrobiłam.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skąd ten mail?' })).toHaveAttribute('aria-disabled', 'false');
  });

  it('podgląd ukończonego bloku: bez pisania i opóźnień (kwestia otwierająca od razu, odpowiedzi od razu)', () => {
    setup({ ...dialogue, character: { ...dialogue.character!, opening: 'Ja naprawdę nic nie zrobiłam.' } }, { review: true });
    expect(screen.getByText('Ja naprawdę nic nie zrobiłam.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    expect(screen.queryByTestId('dialogue-typing')).not.toBeInTheDocument();
    expect(screen.getByText('Kliknęłam w link.')).toBeInTheDocument();
  });

  it('odstępy: 6 px w obrębie osoby, 12 px między osobami; kolumna wątku max 760 px, wyśrodkowana', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    typeAll(3);
    const items = within(screen.getByTestId('dialogue-thread')).getAllByRole('listitem');
    expect(items.map((item) => item.dataset.speaker)).toEqual(['player', 'character', 'character', 'character']);
    expect(items[0].className).not.toMatch(/mt-/);
    expect(items[1].className).toMatch(/\bmt-3\b/);
    expect(items[2].className).toMatch(/\bmt-1\.5\b/);
    expect(screen.getByTestId('dialogue-thread').className).toMatch(/max-w-\[760px\]/);
    expect(screen.getByTestId('dialogue-thread').className).toMatch(/\bmx-auto\b/);
  });

  it('porzucona rozmowa nie liczy się: bez ostatniej kwestii pytanie nie jest w odpowiedzi', () => {
    const { onSubmit, ready } = setup(dialogue); // q1 (3 kwestie) jest wymagane
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    typeAll(2); // 2 z 3 kwestii i koniec
    expect(ready.current).toBeNull();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('porzucone w połowie pytanie OPCJONALNE nie trafia do odpowiedzi, ukończone tak', () => {
    const block: ContentBlock = {
      ...dialogue,
      questions: [
        { id: 'q1', text: 'Pierwsze?', answer: 'Tak.', required: true },
        { id: 'q2', text: 'Drugie?', lines: [{ text: 'Raz.' }, { text: 'Dwa.' }], required: false },
      ],
    };
    const { onSubmit, ready } = setup(block);
    fireEvent.click(screen.getByRole('button', { name: 'Pierwsze?' }));
    typeNext();
    fireEvent.click(screen.getByRole('button', { name: 'Drugie?' }));
    typeNext();
    ready.current!(); // wymagane q1 zrobione, q2 w połowie
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1'] });
  });

  it('fokus: po kliknięciu chip znika - fokus na stopce; po ostatniej kwestii - na PIERWSZYM pozostałym chipie', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    expect(screen.getByRole('group', { name: 'Pytania i postęp rozmowy' })).toHaveFocus();
    typeAll(3);
    expect(screen.getByRole('button', { name: 'Kto go wysłał?' })).toHaveFocus();
  });

  it('ostatnie pytanie (bez pozostałych chipów): fokus na kontenerze stopki (bez przycisku "Zakończ rozmowę")', () => {
    const block: ContentBlock = {
      ...dialogue,
      questions: [{ id: 'q2', text: 'Kto go wysłał?', answer: 'Nie znam nadawcy.', required: false, note: { text: 'Nieznany nadawca.', kind: 'person' } }],
    };
    setup(block);
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    typeNext();
    expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pytania do zadania' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Pytania i postęp rozmowy' })).toHaveFocus();
  });

  it('avatar tylko przez <img> z bazy zasobów; niepoprawna ścieżka = brak obrazu', () => {
    const { unmount } = render(
      <NotesProvider initial={[]}>
        <EvidenceProvider summary={undefined}>
          <HintProvider resetKey="k">
            <ExploratoryBlock block={dialogue} contentBase="/content" onSubmit={() => {}} onReady={() => {}} disabled={false} />
          </HintProvider>
        </EvidenceProvider>
      </NotesProvider>,
    );
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', '/content/img/anna.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    unmount();

    render(
      <NotesProvider initial={[]}>
        <EvidenceProvider summary={undefined}>
          <HintProvider resetKey="k">
            <ExploratoryBlock
              block={{ ...dialogue, character: { name: 'Anna', avatar: 'https://evil.example/a.png' } }}
              contentBase="/content"
              onSubmit={() => {}}
              onReady={() => {}}
              disabled={false}
            />
          </HintProvider>
        </EvidenceProvider>
      </NotesProvider>,
    );
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('DIALOGUE: sticky pytania i autoprzewijanie wątku (fix/dialogue-sticky-questions)', () => {
  // jsdom nie liczy layoutu (scrollHeight/clientHeight/scrollTop zawsze 0) - ustawiamy ręcznie przez
  // Object.defineProperty (ten sam wzorzec co ScenePanContainer.test.tsx), Element.prototype.scrollTo jest no-opem
  // z vitest.setup.ts - tu podmieniamy go na vi.fn(), żeby sprawdzić WOŁANIE, nie efekt.
  function stubLogDimensions(log: HTMLElement, { scrollHeight, clientHeight, scrollTop = 0 }: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
    Object.defineProperty(log, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(log, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nowa wiadomość (klik chipa) przewija wątek do najnowszej (scrollTo z top=scrollHeight)', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300 });
    const scrollTo = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('user przewinął w górę (>80px od dołu): kolejna wiadomość NIE przewija wątku, pokazuje się "Nowe wiadomości"; klik w przycisk przewija i go chowa', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300 });
    const scrollTo = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});

    // Realistyczny punkt startowy "przy dole" (w prawdziwej przeglądarce scrollTo automatycznie przesuwa scrollTop
    // i odpala zdarzenia scroll po drodze - tu symulujemy TEN sam stan jawnym zdarzeniem), żeby kolejny ruch był
    // faktycznym, WYKRYWALNYM ruchem W GÓRĘ (kierunek, nie tylko próg 80px - kod review, wyścig ze scrollTo smooth).
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(log);

    // User przewija W GÓRĘ do scrollTop=200: odległość od dołu = 1000-200-300=500 > 80px.
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
    fireEvent.scroll(log);
    expect(screen.queryByRole('button', { name: '↓ Nowe wiadomości' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '↓ Nowe wiadomości' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '↓ Nowe wiadomości' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: '↓ Nowe wiadomości' })).not.toBeInTheDocument();
  });

  it('user samodzielnie doscrollował do dołu (fireEvent.scroll z odległością <=80px): "Nowe wiadomości" nie pojawia się, a kolejna wiadomość DALEJ autoprzewija (scrollTo faktycznie wołane)', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300 });
    const scrollTo = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});

    // Baseline "przy dole", potem genuinie odjechał (ruch w górę - scrollTop maleje względem poprzedniego odczytu),
    // potem sam wrócił blisko dołu (ruch w dół, odległość 50px <= 80px).
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(log);
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 300 });
    fireEvent.scroll(log);
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 650 });
    fireEvent.scroll(log);

    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    expect(screen.queryByRole('button', { name: '↓ Nowe wiadomości' })).not.toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('kod review (druga runda - test MUSI odróżniać starą logikę od nowej): kilka zdarzeń scroll o NIEMALEJĄCYM scrollTop (symulacja klatek animacji scrollTo({behavior:"smooth"}) JESZCZE W TOKU) NIE wyłącza autoprzewijania, mimo że w chwili nadejścia kolejnej wiadomości bieżąca klatka wciąż jest >80px od dołu', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    const scrollTo = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});

    // scrollTop rośnie klatka po klatce w stronę celu (700) - w połowie drogi odległość od dołu bywa >80px, mimo że
    // to NIE jest user odjeżdżający od dołu, tylko WŁASNA animacja jeszcze w toku. Kluczowe: NIE dojeżdżamy do
    // scrollTop=700 (dist=0) przed kliknięciem - stara logika (`stickToBottomRef.current = atBottom` bezwarunkowo
    // przy KAŻDYM zdarzeniu) i tak "naprawiłaby się" na ostatniej klatce, gdyby ta akurat trafiła w próg 80px, więc
    // test kończący się na klatce z dist<=80 NIE odróżniałby starej logiki od nowej (kod review, druga runda).
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 300 }); // dist=400>80
    fireEvent.scroll(log);
    stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 600 }); // dist=100>80 - WCIĄŻ nie przy dole
    fireEvent.scroll(log);

    // Kolejna wiadomość przychodzi W TRAKCIE animacji (bieżąca klatka: dist=100>80px). Stara logika ustawiłaby tu
    // stickToBottomRef=false (atBottom=false) i NIE wywołałaby scrollTo - to jest dokładnie błąd, który ten test ma
    // łapać. Nowa (kierunkowa) logika: scrollTop przez cały czas rósł, więc przyklejenie NIGDY nie zostało wyłączone.
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: '↓ Nowe wiadomości' })).not.toBeInTheDocument();
  });

  it('prefers-reduced-motion: scrollTo z behavior "auto" zamiast "smooth"', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null }) as unknown as MediaQueryList;
    try {
      setup(dialogue);
      const log = screen.getByRole('log', { name: 'Historia rozmowy' });
      stubLogDimensions(log, { scrollHeight: 1000, clientHeight: 300 });
      const scrollTo = vi.spyOn(log, 'scrollTo').mockImplementation(() => {});

      fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
      expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('lista pytań (chipy) NIE jest potomkiem wątku (role="log") - poza obszarem przewijania, zawsze widoczna', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    expect(within(log).queryByRole('list', { name: 'Pytania do zadania' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pytania do zadania' })).toBeInTheDocument();
  });

  it('wątek: role="log", aria-live="polite", tabIndex=0 (przewijalny klawiaturą/Tab, nie tylko programowo)', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log.tabIndex).toBe(0);
  });

  it('role="log" idzie na kontener WOKÓŁ wątku, NIE bezpośrednio na <ol> - <ol> w środku zachowuje domyślną rolę listy (kod review: role="log" na <ol> nadpisywałoby ją i osierocało <li>)', () => {
    setup(dialogue);
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    expect(within(log).getByRole('list')).toBeInTheDocument();
  });
});

describe('DIALOGUE: dymki w-fit/max-w-[75%], avatar gracza, pasek podpowiedzi (fix/dialogue-polish)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dymek gracza (pytanie) ma w-fit max-w-[75%] (dopasowany do treści)', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    const bubble = screen.getByText('Kto go wysłał?').closest('p') as HTMLElement;
    expect(bubble.className).toMatch(/\bw-fit\b/);
    expect(bubble.className).toMatch(/max-w-\[75%\]/);
    expect(bubble.className).toMatch(/\bbreak-words\b/);
  });

  it('dymek postaci ma w-fit max-w-[75%]', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    typeNext();
    const bubble = screen.getByText('Nie znam nadawcy.').closest('p') as HTMLElement;
    expect(bubble.className).toMatch(/\bw-fit\b/);
    expect(bubble.className).toMatch(/max-w-\[75%\]/);
  });

  it('avatar gracza renderuje się z myAvatarUrl (AvatarDisplay - preset), po prawej dymka, dekoracyjny (aria-hidden)', () => {
    setup(dialogue, { myAvatarUrl: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    const bubble = screen.getByText('Kto go wysłał?').closest('div') as HTMLElement;
    const avatarWrapper = bubble.querySelector('[aria-hidden="true"]');
    expect(avatarWrapper).toBeInTheDocument();
    // AVATAR_PRESETS renderuje ikonę Lucide w <span role="img"> - potomek wrappera aria-hidden, więc niewidoczny dla AT.
    expect(avatarWrapper?.querySelector('[role="img"]')).toBeInTheDocument();
  });

  it('bez myAvatarUrl: fallback na inicjały z myInitials (AvatarDisplay)', () => {
    setup(dialogue, { myAvatarUrl: null, myInitials: 'JK' });
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    const bubble = screen.getByText('Kto go wysłał?').closest('div') as HTMLElement;
    expect(bubble).toHaveTextContent('JK');
  });

  it('pytanie WIELOKWESTYJNE (q1, 3 linie): avatar postaci TYLKO przy OSTATNIEJ kwestii serii, wcześniejsze mają pustą rezerwację miejsca', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    typeAll(3); // wszystkie 3 kwestie pokazane

    // <img alt=""> dostaje implicit role="presentation" (HTML-AAM), nie "img" - getByRole nic by nie znalazł;
    // zwykłe querySelectorAll wewnątrz wątku, jak w istniejącym teście "avatar tylko przez <img> z bazy zasobów".
    const log = screen.getByRole('log', { name: 'Historia rozmowy' });
    const avatarImgs = log.querySelectorAll('img');
    // Awatar Anny (character.avatar='img/anna.png') pojawia się dokładnie RAZ (przy ostatniej kwestii serii), mimo
    // że seria ma 3 kwestie - wcześniejsze dwie dostają pustą rezerwację miejsca (aria-hidden <span>, nie <img>).
    expect(avatarImgs).toHaveLength(1);
    // Ten JEDEN <img> stoi przy OSTATNIEJ kwestii serii ("Kliknęłam w link.", trzecia z trzech linii q1) - nie przy
    // pierwszej/drugiej. CharacterBubble renderuje avatar i tekst jako rodzeństwo w tym samym <div> (flex items-end
    // gap-2), więc wspólny przodek z tekstem trzeciej kwestii jest wystarczającym, precyzyjnym dowodem pozycji.
    expect(avatarImgs[0].closest('div')).toContainElement(screen.getByText('Kliknęłam w link.'));
    expect(avatarImgs[0].closest('div')).not.toContainElement(screen.getByText('Przyszedł rano.'));
    expect(avatarImgs[0].closest('div')).not.toContainElement(screen.getByText('Wyglądał jak od banku.'));
  });

  it('pasek podpowiedzi (Hint bar) w DIALOGUE renderuje się z tekstem block.mascot (pose ignorowana) - NIE nakładka sceny', () => {
    setup({ ...dialogue, mascot: { pose: 'pointing', text: 'Zapytaj o nadawcę.' } });
    expect(screen.getByTestId('hint-bar')).toHaveTextContent('Zapytaj o nadawcę.');
    expect(screen.queryByTestId('hint-overlay')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /maskotka/i })).not.toBeInTheDocument();
  });

  it('D-096: pasek w DIALOGUE z `tip` (wygrywa z przestarzałym mascot.text)', () => {
    setup({ ...dialogue, tip: 'Pytaj o godziny.', mascot: { pose: 'pointing', text: 'Stary tekst.' } });
    expect(screen.getByTestId('hint-bar')).toHaveTextContent('Pytaj o godziny.');
  });

  it('DIALOGUE bez block.mascot i bez zdarzenia: brak paska (rozmowa nie ma domyślnej podpowiedzi)', () => {
    setup(dialogue);
    expect(screen.queryByTestId('hint-bar')).not.toBeInTheDocument();
  });

  it('podgląd "Wstecz" (review=true): pasek podpowiedzi NIE renderuje się (unika przecieku reakcji z żywego bloku, dzieli ten sam HintProvider)', () => {
    setup({ ...dialogue, mascot: { pose: 'pointing', text: 'Zapytaj o nadawcę.' } }, { review: true });
    expect(screen.queryByTestId('hint-bar')).not.toBeInTheDocument();
  });
});

describe('SUMMARY: rozwiązanie sprawy', () => {
  const summary: EvidenceSummary = {
    collected: 3,
    total: 6,
    perBlock: [
      { blockId: 'scena', collected: 1, total: 3 },
      { blockId: 'rozmowa', collected: 2, total: 2 },
      { blockId: 'mail', collected: 0, total: 1 },
    ],
  };

  it('zebrane vs wszystkie, przeoczone tylko liczbowo per scena (bez treści); bez własnego przycisku - gotowy od razu (D-106)', () => {
    const { onSubmit, ready } = setup({ type: 'SUMMARY', id: 's', text: 'Wnioski: zawsze sprawdzaj nadawcę.' }, { summary, titles: { scena: 'Biuro', rozmowa: 'Rozmowa z Anną', mail: 'Analiza maila' } });
    const evidence = screen.getByTestId('case-evidence');
    expect(evidence).toHaveTextContent('Zebrane dowody: 3 z 6');
    expect(evidence).toHaveTextContent('Biuro: 1 z 3 (2 dowody w tej scenie pozostały nieodkryte)');
    expect(evidence).toHaveTextContent('Rozmowa z Anną: 2 z 2');
    expect(evidence).not.toHaveTextContent('Rozmowa z Anną: 2 z 2 (');
    expect(evidence).toHaveTextContent('Analiza maila: 0 z 1 (1 dowód w tej scenie pozostał nieodkryty)');
    // Ani nazwy, ani treści przeoczonych elementów (tekst notatek hotspotów, których nie zebrano, nie trafia do klienta w ogóle).
    expect(evidence.textContent).not.toMatch(/Kubek|Drzwi|Monitor/);
    expect(screen.getByText('Wnioski: zawsze sprawdzaj nadawcę.')).toBeInTheDocument();
    expect(screen.getByText('Wynik z zadań zobaczysz po zakończeniu sprawy.')).toBeInTheDocument();
    // „Zakończ sprawę” to etykieta „Dalej” w dolnym pasku (CoursePlayer), nie przycisk w bloku.
    expect(screen.queryByRole('button', { name: /Zakończ/ })).not.toBeInTheDocument();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('liczba mnoga: 1 dowód, 2-4 dowody, 5+ dowodów, 12 dowodów', () => {
    setup(
      { type: 'SUMMARY', id: 's' },
      {
        summary: {
          collected: 0,
          total: 24,
          perBlock: [
            { blockId: 'a', collected: 0, total: 1 },
            { blockId: 'b', collected: 0, total: 4 },
            { blockId: 'c', collected: 0, total: 5 },
            { blockId: 'd', collected: 0, total: 12 },
          ],
        },
        titles: { a: 'A', b: 'B', c: 'C', d: 'D' },
      },
    );
    const text = screen.getByTestId('case-evidence').textContent ?? '';
    expect(text).toContain('1 dowód w tej scenie pozostał nieodkryty');
    expect(text).toContain('4 dowody w tej scenie pozostały nieodkryte');
    expect(text).toContain('5 dowodów w tej scenie pozostało nieodkrytych');
    expect(text).toContain('12 dowodów w tej scenie pozostało nieodkrytych');
  });

  it('bez dowodów w module: bez sekcji dowodów i bez zdania o wyniku z zadań', () => {
    setup({ type: 'SUMMARY', id: 's', text: 'Dziękujemy.' });
    expect(screen.queryByTestId('case-evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Wynik z zadań zobaczysz po zakończeniu sprawy.')).not.toBeInTheDocument();
  });
});

describe('EvidenceCounter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const withSummary = (summary: EvidenceSummary | undefined) => (
    <EvidenceProvider summary={summary}>
      <EvidenceCounter />
    </EvidenceProvider>
  );
  const s = (collected: number, total: number): EvidenceSummary => ({ collected, total, perBlock: [{ blockId: 'a', collected, total }] });

  it('nie pokazuje się w module bez dowodów', () => {
    render(withSummary(undefined));
    expect(screen.queryByTestId('evidence-counter')).not.toBeInTheDocument();
  });

  it('nowy dowód: krótkie +1 (znika po chwili), animacja tylko motion-safe; brak +1 przy pierwszym renderze', () => {
    const { rerender } = render(withSummary(s(1, 5)));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/5');
    expect(screen.queryByTestId('evidence-plus-one')).not.toBeInTheDocument();

    rerender(withSummary(s(2, 5)));
    const plusOne = screen.getByTestId('evidence-plus-one');
    expect(plusOne.className).toContain('motion-safe:animate-bounce');
    expect(plusOne.className).not.toMatch(/(^|\s)animate-/);
    // "+1" jest W WIERSZU licznika (zarezerwowane miejsce, nie pozycjonowane absolutnie poza pasek postępu).
    expect(screen.getByTestId('evidence-counter')).toContainElement(plusOne);
    expect(plusOne.className).not.toContain('absolute');
    expect(plusOne.parentElement?.className).not.toContain('absolute');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 2/5');

    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.queryByTestId('evidence-plus-one')).not.toBeInTheDocument();
  });

  it('po zapisie bloku (nowe liczby z serwera) dowód lokalny nie liczy się podwójnie i nie daje drugiego +1', () => {
    let add: (key: string) => void = () => {};
    function Grab() {
      add = useEvidence().addPending;
      return null;
    }
    const tree = (summary: EvidenceSummary) => (
      <EvidenceProvider summary={summary}>
        <EvidenceCounter />
        <Grab />
      </EvidenceProvider>
    );
    const { rerender } = render(tree(s(0, 2)));

    act(() => add('scena.h1')); // dowód w niezapisanym bloku: 1/2 i jedno +1
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getAllByTestId('evidence-plus-one')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1700);
    });

    rerender(tree(s(1, 2))); // serwer zapisał blok: te same liczby, bez podwójnego liczenia i bez nowego +1
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.queryByTestId('evidence-plus-one')).not.toBeInTheDocument();
  });
});
