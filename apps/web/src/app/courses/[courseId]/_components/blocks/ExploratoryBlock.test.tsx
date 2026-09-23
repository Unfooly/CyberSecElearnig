import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ExploratoryBlock from './ExploratoryBlock';
import { NotesProvider, useNotes } from '../player/notes';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
import type { ContentBlock } from '@/lib/courses-types';

const BASE = '/content';

// Projekt nie ma @testing-library/user-event (stos z CLAUDE.md: Vitest + RTL): cienka nakładka na fireEvent w tym samym stylu wywołań.
const userEvent = {
  setup: () => ({
    click: async (element: Element) => {
      fireEvent.click(element);
    },
    // Klawisz w formie "{ArrowRight}" trafia do aktualnie sfokusowanego elementu.
    keyboard: async (keys: string) => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: keys.replace(/[{}]/g, '') });
    },
  }),
};

const hotspots: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'h1',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    { id: 'a', label: 'Monitor', x: 10, y: 10, width: 20, height: 20, content: 'Zablokuj ekran.' },
    { id: 'b', label: 'Biurko', x: 50, y: 50, width: 20, height: 20, content: 'Schowaj dokumenty.' },
    { id: 'c', label: 'Drzwi', x: 70, y: 10, width: 10, height: 30, content: 'Nie wpuszczaj obcych.' },
  ],
  requiredHotspots: ['a', 'b'],
};

const dialogue: ContentBlock = {
  type: 'DIALOGUE',
  id: 'd1',
  character: { name: 'Anna', role: 'Księgowa' },
  questions: [
    { id: 'q1', text: 'Co się stało?', answer: 'Dostałam dziwny mail.', note: { text: 'Sprawdź nadawcę.' } },
    { id: 'q2', text: 'Kliknęłaś?', answer: 'Tak, niestety.' },
  ],
};

const tabs: ContentBlock = {
  type: 'TABS',
  id: 't1',
  title: 'Zasady',
  tabs: [
    { id: 'x', title: 'Hasła', content: 'Długie hasła.' },
    { id: 'y', title: 'Maile', content: 'Sprawdzaj linki.' },
    { id: 'z', title: 'Urządzenia', content: 'Blokuj ekran.' },
  ],
  requiredTabs: ['x', 'y'],
};

// "Dalej" żyje w pasku powłoki (CoursePlayer), nie w bloku - blok zgłasza gotowość przez onReady (funkcja submit albo
// null). `ready` to referencja na ostatnio zgłoszoną funkcję; testy "klikają Dalej" wywołując ready.current().
function renderBlock(block: ContentBlock, props: { review?: boolean; onSubmit?: (a?: unknown) => void; notes?: { blockId: string; text: string }[] } = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  function NotesProbe() {
    const { notes } = useNotes();
    return <output data-testid="notes">{notes.map((n) => n.text).join('|')}</output>;
  }
  function ReactionProbe() {
    return <output data-testid="reaction">{useMascotReaction().reaction?.pose ?? ''}</output>;
  }
  render(
    <MascotReactionProvider resetKey="k">
      <NotesProvider initial={props.notes ?? []}>
        <ExploratoryBlock
          block={block}
          contentBase={BASE}
          onSubmit={onSubmit}
          onReady={(submit) => {
            ready.current = submit;
          }}
          disabled={false}
          review={props.review}
        />
        <NotesProbe />
        <ReactionProbe />
      </NotesProvider>
    </MascotReactionProvider>,
  );
  return { onSubmit, ready };
}

describe('SCENE_HOTSPOTS', () => {
  it('ukończenie (onReady) dopiero po wymaganych punktach i odpowiedź { visited }', async () => {
    const user = userEvent.setup();
    const { onSubmit, ready } = renderBlock(hotspots);
    expect(ready.current).toBeNull();
    expect(screen.getByText('Obejrzano 0 z 2 elementów.')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Elementy sceny' });
    await user.click(within(list).getByRole('button', { name: 'Monitor' }));
    expect(screen.getByText('Zablokuj ekran.')).toBeInTheDocument();
    expect(ready.current).toBeNull();

    await user.click(within(list).getByRole('button', { name: 'Biurko' }));
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['a', 'b'], noted: [] });
  });

  it('obraz tylko z bazy zasobów, przez <img> z tekstem alternatywnym; ścieżka spoza reguł = brak obrazu, lista nadal działa', () => {
    renderBlock(hotspots);
    const img = screen.getByRole('img', { name: 'Biuro' });
    expect(img).toHaveAttribute('src', '/content/scenes/office.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('niepoprawna ścieżka obrazu nie ładuje niczego', () => {
    renderBlock({ ...hotspots, image: 'https://evil.example/x.png' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monitor' })).toBeInTheDocument();
  });

  it('bez requiredHotspots wymagane są wszystkie', async () => {
    const user = userEvent.setup();
    const { ready } = renderBlock({ ...hotspots, requiredHotspots: undefined });
    expect(screen.getByText('Obejrzano 0 z 3 elementów.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Elementy sceny' });
    await user.click(within(list).getByRole('button', { name: 'Monitor' }));
    await user.click(within(list).getByRole('button', { name: 'Biurko' }));
    expect(ready.current).toBeNull();
  });

  it('podgląd: interaktywny, ale nigdy nie zgłasza gotowości ani nie woła onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit, ready } = renderBlock(hotspots, { review: true });
    await user.click(within(screen.getByRole('list', { name: 'Elementy sceny' })).getByRole('button', { name: 'Drzwi' }));
    expect(screen.getByText('Nie wpuszczaj obcych.')).toBeInTheDocument();
    expect(ready.current).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reactions.complete (schemaVersion 4) odpala reakcję maskotki dopiero po wymaganych punktach, nigdy w podglądzie', async () => {
    const user = userEvent.setup();
    const withReaction: ContentBlock = { ...hotspots, reactions: { complete: { pose: 'cheer', text: 'Wszystko widziane!' } } };
    renderBlock(withReaction);
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
    const list = screen.getByRole('list', { name: 'Elementy sceny' });
    await user.click(within(list).getByRole('button', { name: 'Monitor' }));
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
    await user.click(within(list).getByRole('button', { name: 'Biurko' }));
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');
  });

  it('reactions.complete nie odpala się w podglądzie ("Wstecz")', async () => {
    const user = userEvent.setup();
    const withReaction: ContentBlock = { ...hotspots, reactions: { complete: { pose: 'cheer', text: 'Wszystko widziane!' } } };
    renderBlock(withReaction, { review: true });
    const list = screen.getByRole('list', { name: 'Elementy sceny' });
    await user.click(within(list).getByRole('button', { name: 'Monitor' }));
    await user.click(within(list).getByRole('button', { name: 'Biurko' }));
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
  });
});

describe('DIALOGUE', () => {
  it('zadane pytanie znika z listy chipów, trafia do rozmowy, notatka do notatnika; odpowiedź { asked }', async () => {
    const user = userEvent.setup();
    const { onSubmit, ready } = renderBlock(dialogue);
    await user.click(screen.getByRole('button', { name: 'Co się stało?' }));
    expect(screen.getByText('Dostałam dziwny mail.')).toBeInTheDocument();
    // Zadane pytanie znika z listy chipów (zostaje tylko w wątku rozmowy powyżej).
    expect(within(screen.getByRole('list', { name: 'Pytania do zadania' })).queryByRole('button', { name: /Co się stało\?/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('Sprawdź nadawcę.');
    expect(ready.current).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Kliknęłaś?' }));
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1', 'q2'] });
  });

  it('podgląd nie dopisuje notatek', async () => {
    const user = userEvent.setup();
    renderBlock(dialogue, { review: true });
    await user.click(screen.getByRole('button', { name: 'Co się stało?' }));
    expect(screen.getByTestId('notes')).toHaveTextContent('');
  });

  it('character.opening (schemaVersion 4) pokazuje pierwszą kwestię postaci (z avatarem, gdy jest), zanim padnie jakiekolwiek pytanie', () => {
    renderBlock({ ...dialogue, character: { ...dialogue.character!, opening: 'Cześć, potrzebuję pomocy.' } });
    expect(screen.getByText('Cześć, potrzebuję pomocy.')).toBeInTheDocument();
  });

  it('notatka nie dubluje się z notatką już zapisaną przez serwer', async () => {
    const user = userEvent.setup();
    renderBlock(dialogue, { notes: [{ blockId: 'd1', text: 'Sprawdź nadawcę.' }] });
    await user.click(screen.getByRole('button', { name: 'Co się stało?' }));
    expect(screen.getByTestId('notes').textContent).toBe('Sprawdź nadawcę.');
  });
});

describe('TABS', () => {
  it('pierwsza zakładka liczy się jako otwarta; nawigacja strzałkami/Home/End; odpowiedź { opened }', async () => {
    const user = userEvent.setup();
    const { onSubmit, ready } = renderBlock(tabs);
    expect(screen.getByRole('tab', { name: 'Hasła' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Długie hasła.');
    expect(ready.current).toBeNull();

    screen.getByRole('tab', { name: 'Hasła' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Maile' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Maile' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Sprawdzaj linki.');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Urządzenia' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Hasła' })).toHaveFocus();

    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ opened: ['x', 'y', 'z'] });
  });

  it('roving tabindex: tylko aktywna zakładka w kolejności Tab', () => {
    renderBlock(tabs);
    expect(screen.getByRole('tab', { name: 'Hasła' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Maile' })).toHaveAttribute('tabindex', '-1');
  });

  it('treść zakładki renderuje wąski markdown (pogrubienie)', () => {
    renderBlock({ ...tabs, tabs: [{ id: 'x', title: 'Hasła', content: '**Długie** hasła.' }] });
    const strong = screen.getByText('Długie');
    expect(strong.tagName).toBe('STRONG');
  });
});

describe('NOTEPAD i SUMMARY', () => {
  it('NOTEPAD pokazuje notatki, gotowy (onReady) od razu po zamontowaniu, bez odpowiedzi', () => {
    const { onSubmit, ready } = renderBlock({ type: 'NOTEPAD', id: 'n1', prompt: 'Zapisz wnioski' }, { notes: [{ blockId: 'd1', text: 'Sprawdź nadawcę.' }] });
    expect(screen.getByText('Zapisz wnioski')).toBeInTheDocument();
    expect(screen.getAllByText('Sprawdź nadawcę.').length).toBeGreaterThan(0);
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith();
  });

  // SUMMARY zostaje wyjątkiem: ma WŁASNY, jedyny przycisk ukończenia (Dalej w pasku powłoki jest dla niego ukryty w
  // CoursePlayer), bez onReady - patrz ExploratoryBlock.tsx.
  it('SUMMARY pokazuje tekst i notatki; w podglądzie bez przycisku', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderBlock({ type: 'SUMMARY', id: 's1', text: 'Dobra robota.' }, { notes: [{ blockId: 'd1', text: 'Sprawdź nadawcę.' }] });
    expect(screen.getByText('Dobra robota.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Twoje notatki' })).getByText('Sprawdź nadawcę.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zakończ szkolenie' }));
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('SUMMARY w podglądzie nie ma przycisku ukończenia', () => {
    renderBlock({ type: 'SUMMARY', id: 's1', text: 'Dobra robota.' }, { review: true });
    expect(screen.queryByRole('button', { name: 'Zakończ szkolenie' })).not.toBeInTheDocument();
  });

  it('SUMMARY renderuje tekst przez wąski markdown (pogrubienie)', () => {
    renderBlock({ type: 'SUMMARY', id: 's1', text: '**Brawo!** Sprawa zamknięta.' });
    const strong = screen.getByText('Brawo!');
    expect(strong.tagName).toBe('STRONG');
  });
});

describe('NARRATIVE (schemaVersion 4)', () => {
  it('pokazuje tytuł i tekst, gotowy (onReady) od razu po zamontowaniu, bez odpowiedzi', () => {
    const { onSubmit, ready } = renderBlock({ type: 'NARRATIVE', id: 'n1', title: 'Sprawa', text: 'To się wydarzyło...' });
    expect(screen.getByText('Sprawa')).toBeInTheDocument();
    expect(screen.getByText('To się wydarzyło...')).toBeInTheDocument();
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('w podglądzie nigdy nie zgłasza gotowości (nie da się ukończyć bloku ponownie)', () => {
    const { ready } = renderBlock({ type: 'NARRATIVE', id: 'n1', text: 'To się wydarzyło...' }, { review: true });
    expect(ready.current).toBeNull();
  });

  it('renderuje tekst przez wąski markdown (pogrubienie)', () => {
    renderBlock({ type: 'NARRATIVE', id: 'n1', text: '**Ważne.** Reszta zwykłym tekstem.' });
    const strong = screen.getByText('Ważne.');
    expect(strong.tagName).toBe('STRONG');
  });

  it('reactions.complete odpala się od razu po zamontowaniu (bez elementów do pokrycia), nigdy w podglądzie', () => {
    const withReaction: ContentBlock = {
      type: 'NARRATIVE',
      id: 'n1',
      text: 'To się wydarzyło...',
      reactions: { complete: { pose: 'thinking', text: 'Ciekawe...' } },
    };
    renderBlock(withReaction);
    expect(screen.getByTestId('reaction')).toHaveTextContent('thinking');
  });

  it('reactions.complete nie odpala się w podglądzie', () => {
    const withReaction: ContentBlock = {
      type: 'NARRATIVE',
      id: 'n1',
      text: 'To się wydarzyło...',
      reactions: { complete: { pose: 'thinking', text: 'Ciekawe...' } },
    };
    renderBlock(withReaction, { review: true });
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
  });
});
