import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ExploratoryBlock from './ExploratoryBlock';
import { NotesProvider, NotesPanel, useNotes } from '../player/notes';
import { EvidenceCounter, EvidenceProvider, useEvidence } from '../player/evidence';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
import type { ContentBlock, EvidenceSummary } from '@/lib/courses-types';

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
  const { reaction } = useMascotReaction();
  return (
    <>
      <output data-testid="notes">{notes.map((n) => `${n.kind ?? '-'}:${n.text}`).join('|')}</output>
      <output data-testid="reaction">{reaction?.pose ?? ''}</output>
    </>
  );
}

// "Dalej" żyje w pasku powłoki (CoursePlayer), nie w bloku - blok zgłasza gotowość przez onReady (funkcja submit albo
// null). `ready` to referencja na ostatnio zgłoszoną funkcję; testy "klikają Dalej" wywołując ready.current().
function setup(
  block: ContentBlock,
  options: { review?: boolean; summary?: EvidenceSummary; titles?: Record<string, string>; onSubmit?: (a?: unknown) => void } = {},
) {
  const onSubmit = options.onSubmit ?? vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  render(
    <NotesProvider initial={[]} blockTitles={options.titles ?? { scena: 'Biuro', rozmowa: 'Rozmowa z Anną' }}>
      <EvidenceProvider summary={options.summary}>
        <MascotReactionProvider resetKey="k">
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
          />
          <Probe />
          <NotesPanel id="panel" />
        </MascotReactionProvider>
      </EvidenceProvider>
    </NotesProvider>,
  );
  return { onSubmit, ready };
}

const list = () => screen.getByRole('list', { name: 'Elementy sceny' });
const pick = (name: string) => fireEvent.click(within(list()).getByRole('button', { name }));

describe('SCENE_HOTSPOTS: punkty, karta i dowody', () => {
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

  it('nakładki są aria-hidden i poza kolejnością Tab (jedna ścieżka: lista)', () => {
    setup(scene, { summary });
    const overlay = screen.getByTestId('hotspot-overlay-h1');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveAttribute('tabindex', '-1');
  });

  it('kliknięty punkt otwiera kartę; "Dodaj do notatnika" tylko przy dowodzie, wpis z ikoną rodzaju, licznik i maskotka reagują', () => {
    const { onSubmit, ready } = setup(scene, { summary });
    pick('Monitor');
    const card = screen.getByTestId('hotspot-card');
    expect(card).toHaveTextContent('Kartka z hasłem.');

    fireEvent.click(within(card).getByRole('button', { name: 'Dodaj do notatnika' }));
    expect(within(card).queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
    expect(within(card).getByText('Dodano do notatnika')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Hasło na kartce.');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');

    // Panel notatnika: grupa z nazwą sceny, ikona (etykieta) rodzaju.
    const panel = screen.getByRole('complementary', { name: 'Notatnik' });
    expect(within(panel).getByRole('region', { name: 'Biuro' })).toHaveTextContent('Przedmiot: Hasło na kartce.');

    pick('Drzwi'); // wymagany tylko Monitor
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['h1', 'h2'], noted: ['h1'] });
  });

  it('punkt bez evidence nie ma "Dodaj do notatnika"', () => {
    setup(scene, { summary });
    pick('Drzwi');
    expect(screen.queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
  });

  it('ukończenie po wymaganych (required), nie po wszystkich: opcjonalne punkty ("smaczki") nie blokują', () => {
    const { onSubmit, ready } = setup(scene, { summary });
    expect(screen.getByText('Obejrzano 0 z 1 elementów.')).toBeInTheDocument();
    expect(ready.current).toBeNull();
    pick('Monitor');
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['h1'], noted: [] });
  });

  it('podgląd: brak dodawania do notatnika, brak zmian w notatniku i liczniku', () => {
    setup(scene, { summary, review: true });
    pick('Monitor');
    expect(screen.queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
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
      media: { kind: 'audio', audioUrl: 'audio/poczta-glosowa.mp3', transcript: 'Dzień dobry, dzwonię z banku.' },
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
  ],
};

describe('SCENE_HOTSPOTS: media w karcie (image/audio/document, B-086/D-071)', () => {
  it('image: karta pokazuje podgląd; klik otwiera pełnoekranową nakładkę (Escape zamyka, fokus wraca na przycisk)', () => {
    setup(mediaScene);
    pick('Zdjęcie');
    const preview = screen.getByRole('button', { name: /Powiększ/ });
    fireEvent.click(preview);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByAltText('Zbliżenie karteczki z hasłem')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(preview);
  });

  it('document: karta ma przycisk "Zobacz dokument"; nakładka pokazuje tytuł i linie, przycisk zamknięcia oddaje fokus', () => {
    setup(mediaScene);
    pick('Drukarka');
    const trigger = screen.getByRole('button', { name: /Zobacz dokument/ });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Potwierdzenie przelewu')).toBeInTheDocument();
    expect(within(dialog).getByText(/Kwota: 14 000,00 PLN/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij podgląd' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('audio: <audio> bez autoplay, transkrypcja dostępna OD RAZU (nie czeka na onEnded), insight (content) dopiero po odsłuchaniu', () => {
    setup(mediaScene);
    pick('Telefon');

    expect(screen.queryByText(/Prawdziwy bank nigdy nie prosi/)).not.toBeInTheDocument();

    const audioEl = document.querySelector('audio')!;
    expect(audioEl).toBeInTheDocument();
    expect(audioEl).not.toHaveAttribute('autoplay');
    expect(audioEl).toHaveAttribute('controls');

    const toggle = screen.getByRole('button', { name: 'Pokaż transkrypcję' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Dzień dobry, dzwonię z banku.')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ukryj transkrypcję' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Dzień dobry, dzwonię z banku.')).toBeVisible();

    fireEvent(audioEl, new Event('ended'));
    expect(screen.getByText(/Prawdziwy bank nigdy nie prosi/)).toBeInTheDocument();
  });

  it('audio: dowód zaliczony PRZY OTWARCIU karty, nie po odsłuchaniu (bez przycisku "Dodaj do notatnika")', () => {
    setup(mediaScene);
    pick('Telefon');
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Telefon z podejrzaną prośbą o kod SMS.');
    expect(screen.queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
    expect(screen.getByText('Dodano do notatnika')).toBeInTheDocument();
    // Bez odsłuchania (żaden `ended` nie poleciał) - dowód mimo to już zaliczony.
    expect(document.querySelector('audio')).toBeInTheDocument();
  });

  it('image: dowód też zaliczony przy otwarciu, tak samo jak audio (spójne dla wszystkich mediów)', () => {
    setup(mediaScene);
    pick('Zdjęcie');
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Hasło widoczne na zbliżeniu.');
    expect(screen.queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
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
  it('klik na hotspot z media.kind:"scene" pokazuje jej obraz i listę elementów w karcie', () => {
    setup(nestedScene);
    pick('Monitor');
    expect(screen.getByText('Ekran z otwartym pulpitem.')).toBeInTheDocument();
    const inner = screen.getByRole('list', { name: 'Elementy: Pulpit komputera' });
    expect(within(inner).getByRole('button', { name: 'Outlook' })).toBeInTheDocument();
    expect(within(inner).getByRole('button', { name: 'Kosz' })).toBeInTheDocument();
  });

  it('klik na element WEWNĄTRZ zagnieżdżonej sceny otwiera jego własną kartę i zalicza dowód od razu (image)', () => {
    setup(nestedScene);
    pick('Monitor');
    const inner = screen.getByRole('list', { name: 'Elementy: Pulpit komputera' });
    fireEvent.click(within(inner).getByRole('button', { name: 'Outlook' }));

    expect(screen.getByRole('heading', { name: 'Outlook', level: 4 })).toBeInTheDocument();
    expect(screen.getByText('Program pocztowy.')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('mail:Mail otwarty w programie pocztowym.');
    expect(screen.getByRole('button', { name: /Powiększ: Podgląd maila/ })).toBeInTheDocument();
  });

  it('visited/noted wysłane do serwera zawierają id z WEWNĄTRZ zagnieżdżonej sceny (spłaszczone, D-071)', () => {
    const { onSubmit, ready } = setup(nestedScene);
    pick('Monitor');
    const inner = () => screen.getByRole('list', { name: 'Elementy: Pulpit komputera' });
    fireEvent.click(within(inner()).getByRole('button', { name: 'Outlook' }));
    // Wszystkie wymagane (żaden hotspot nie ma jawnego required -> fallback "wszystkie"): monitor, outlook, kosz, kubek.
    expect(ready.current).toBeNull();
    fireEvent.click(within(inner()).getByRole('button', { name: 'Kosz' }));
    expect(ready.current).toBeNull(); // kubek (zewnętrzny) jeszcze nieodwiedzony
    pick('Kubek');
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: expect.arrayContaining(['monitor', 'outlook', 'kosz', 'kubek']), noted: ['outlook'] });
  });

  it('licznik "Obejrzano X z Y" liczy Y ze spłaszczonego zbioru (4: monitor, outlook, kosz, kubek)', () => {
    setup(nestedScene);
    expect(screen.getByText('Obejrzano 0 z 4 elementów.')).toBeInTheDocument();
  });

  it('zmiana zewnętrznego hotspotu resetuje wybór wewnątrz JEGO zagnieżdżonej sceny', () => {
    setup(nestedScene);
    pick('Monitor');
    fireEvent.click(within(screen.getByRole('list', { name: 'Elementy: Pulpit komputera' })).getByRole('button', { name: 'Outlook' }));
    expect(screen.getByRole('heading', { name: 'Outlook', level: 4 })).toBeInTheDocument();

    pick('Kubek');
    expect(screen.queryByRole('heading', { name: 'Outlook', level: 4 })).not.toBeInTheDocument();

    // Monitor już odwiedzony: dostępna nazwa ma teraz sufiks " (obejrzane)" - dopasowanie dokładne ('pick') by go nie znalazło.
    fireEvent.click(within(list()).getByRole('button', { name: /^Monitor/ }));
    expect(screen.queryByRole('heading', { name: 'Outlook', level: 4 })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Elementy: Pulpit komputera' })).toBeInTheDocument();
  });
});

describe('DIALOGUE: kwestie po jednej', () => {
  it('odpowiedź pojawia się kwestia po kwestii (klik "Następna kwestia"); pytanie liczy się po ostatniej, wtedy notatka, dowód i znika z listy chipów', () => {
    const { onSubmit, ready } = setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));

    expect(screen.getByText('Przyszedł rano.')).toBeInTheDocument();
    expect(screen.queryByText('Wyglądał jak od banku.')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(ready.current).toBeNull();
    expect(screen.getByText('Zadano 0 z 1 pytań.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    expect(screen.getByText('Wyglądał jak od banku.')).toBeInTheDocument();
    expect(screen.queryByText('Kliknęłam w link.')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    expect(screen.getByText('Kliknęłam w link.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Następna kwestia' })).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('mail:Mail przyszedł rano.');
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');
    // Zadane pytanie znika z listy chipów (zostaje tylko w wątku rozmowy powyżej); nieaskane q2 zostaje na liście.
    expect(within(screen.getByRole('list', { name: 'Pytania do zadania' })).queryByRole('button', { name: /Skąd ten mail/ })).not.toBeInTheDocument();
    expect(screen.getByText('Wszystkie wymagane pytania zadane.')).toBeInTheDocument();

    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1'] });
  });

  it('podczas rozmowy inne pytania są nieaktywne, po niej znów dostępne; odpowiedź bez lines to jedna kwestia', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    const other = screen.getByRole('button', { name: 'Kto go wysłał?' });
    expect(other).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(other);
    expect(screen.queryByText('Nie znam nadawcy.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    expect(screen.getByRole('button', { name: 'Kto go wysłał?' })).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('person:Nieznany nadawca.');
    // Notatka bez evidence nie rusza licznika (brak reakcji poza tą z q1).
  });

  it('porzucona rozmowa nie liczy się: bez ostatniej kwestii pytanie nie jest w odpowiedzi', () => {
    const { onSubmit, ready } = setup(dialogue); // q1 (3 kwestie) jest wymagane
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' })); // 2 z 3 kwestii i koniec
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
    fireEvent.click(screen.getByRole('button', { name: 'Drugie?' }));
    ready.current!(); // wymagane q1 zrobione, q2 w połowie
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1'] });
  });

  it('pytanie JEDNOKWESTYJNE (bez "Następna kwestia"): fokus wraca na wątek rozmowy, żeby klawiatura/czytnik ekranu nie zgubiły miejsca po zniknięciu chipa', async () => {
    setup(dialogue); // q2 "Kto go wysłał?" ma tylko `answer`, bez `lines` - kończy się w tym samym kliknięciu
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('list', { name: 'Rozmowa' })).toHaveFocus();
  });

  it('avatar tylko przez <img> z bazy zasobów; niepoprawna ścieżka = brak obrazu', () => {
    const { unmount } = render(
      <NotesProvider initial={[]}>
        <EvidenceProvider summary={undefined}>
          <MascotReactionProvider resetKey="k">
            <ExploratoryBlock block={dialogue} contentBase="/content" onSubmit={() => {}} onReady={() => {}} disabled={false} />
          </MascotReactionProvider>
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
          <MascotReactionProvider resetKey="k">
            <ExploratoryBlock
              block={{ ...dialogue, character: { name: 'Anna', avatar: 'https://evil.example/a.png' } }}
              contentBase="/content"
              onSubmit={() => {}}
              onReady={() => {}}
              disabled={false}
            />
          </MascotReactionProvider>
        </EvidenceProvider>
      </NotesProvider>,
    );
    expect(document.querySelector('img')).toBeNull();
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

  it('zebrane vs wszystkie, przeoczone tylko liczbowo per scena (bez treści), przycisk "Zakończ sprawę"', () => {
    const { onSubmit } = setup({ type: 'SUMMARY', id: 's', text: 'Wnioski: zawsze sprawdzaj nadawcę.' }, { summary, titles: { scena: 'Biuro', rozmowa: 'Rozmowa z Anną', mail: 'Analiza maila' } });
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
    expect(screen.queryByRole('button', { name: 'Zakończ szkolenie' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zakończ sprawę' }));
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

  it('bez dowodów w module: "Zakończ szkolenie", bez sekcji dowodów', () => {
    setup({ type: 'SUMMARY', id: 's', text: 'Dziękujemy.' });
    expect(screen.queryByTestId('case-evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zakończ szkolenie' })).toBeInTheDocument();
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
