import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SceneHotspotsBlock from './SceneHotspotsBlock';
import { NotesProvider, useNotes } from '../player/notes';
import { EvidenceProvider } from '../player/evidence';
import { HintProvider } from '../player/hints';
import { OverlayStackProvider } from '../player/overlay-stack';
import type { ContentBlock, SceneExploration } from '@/lib/courses-types';

// Karty obracane (SCENE_HOTSPOTS presentation: 'flipCards', D-209): klik obraca kartę i pokazuje tekst na odwrocie; pierwsze obrócenie =
// przedmiot obejrzany (dowód do notatnika); po wszystkich wymaganych - gotowość „Dalej”. Układ i rozmiar tekstu: layout-check (karty).

const cards: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'skutki',
  title: 'Co może pójść nie tak',
  image: 'scenes/tablica.webp',
  imageAlt: 'Cztery karty',
  presentation: 'flipCards',
  hotspots: [
    { id: 'dane', label: 'Dane firmy', x: 5, y: 5, width: 40, height: 40, content: 'Dane trafiają na cudze serwery.', cardImage: 'images/dane.webp', required: true, evidence: true, note: { text: 'Skutek: dane na cudzych serwerach.', kind: 'item' } },
    { id: 'pliki', label: 'Utrata plików', x: 50, y: 5, width: 40, height: 40, content: 'Prywatne konto nie ma kopii.', cardImage: 'images/pliki.webp', required: true },
  ],
};

function Notes() {
  const { notes } = useNotes();
  return <output data-testid="notes">{notes.map((n) => n.text).join('|')}</output>;
}

function setup(options: { review?: boolean; initial?: SceneExploration } = {}) {
  const onSubmit = vi.fn();
  const onExplore = vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  render(
    <OverlayStackProvider>
      <NotesProvider initial={[]} blockTitles={{ skutki: 'Co może pójść nie tak' }}>
        <EvidenceProvider summary={undefined}>
          <HintProvider resetKey="k">
            <SceneHotspotsBlock
              block={cards}
              contentBase="/content"
              onSubmit={onSubmit}
              onReady={(submit) => {
                ready.current = submit;
              }}
              onExplore={onExplore}
              review={options.review}
              initial={options.initial}
            />
            <Notes />
          </HintProvider>
        </EvidenceProvider>
      </NotesProvider>
    </OverlayStackProvider>,
  );
  return { onSubmit, onExplore, ready };
}

// Nazwa przycisku = podpis, po obejrzeniu z „(obejrzane)”.
const card = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}( \\(obejrzane\\))?$`) });

describe('FlipCardsBlock (D-209)', () => {
  it('karty z ilustracją i podpisem zamiast sceny; klik obraca kartę i odwrocie opisuje przycisk; drugi klik obraca z powrotem', () => {
    setup();
    expect(screen.getByTestId('flip-cards-block')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Cztery karty' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('flip-card-image').map((img) => img.getAttribute('src'))).toEqual(['/content/images/dane.webp', '/content/images/pliki.webp']);
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card('Dane firmy'));
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'true');
    expect(card('Dane firmy')).toHaveAccessibleDescription('Dane trafiają na cudze serwery.');
    expect(screen.getAllByTestId('flip-card')[0]).toHaveAttribute('data-flipped', 'true');
    fireEvent.click(card('Dane firmy'));
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('flip-card')[0]).toHaveAttribute('data-flipped', 'false');
  });

  it('tytuł na górze karty (2026-11-26, zamiast podpisu pod kartą): na przodzie i na odwrociu, poza nazwą przycisku', () => {
    setup();
    expect(screen.getAllByTestId('flip-card-title').map((title) => title.textContent)).toEqual(['Dane firmy', 'Utrata plików']);
    // Tytuł jest w przodzie karty (pasek na ilustracji), nie pod kartą.
    for (const title of screen.getAllByTestId('flip-card-title')) expect(title.closest('.flip-card-front')).not.toBeNull();
    for (const cell of screen.getAllByTestId('flip-card')) expect(cell.querySelector('.flip-card-back .flip-card-title')).not.toBeNull();
    expect(document.querySelector('.flip-card-label')).toBeNull();
    // Po obróceniu ✓ „obejrzane” przy tytule; nazwę i stan czytnik bierze z przycisku.
    fireEvent.click(card('Dane firmy'));
    expect(screen.getAllByTestId('flip-card-title')[0].querySelector('svg')).not.toBeNull();
    expect(card('Dane firmy')).toHaveAccessibleName('Dane firmy (obejrzane)');
  });

  it('pierwsze obrócenie: dowód do notatnika raz (także po obróceniu z powrotem i ponownie); „Dalej” po wszystkich wymaganych - zapis visited/noted', () => {
    const { onSubmit, onExplore, ready } = setup();
    expect(ready.current).toBeNull();
    fireEvent.click(card('Dane firmy'));
    fireEvent.click(card('Dane firmy'));
    fireEvent.click(card('Dane firmy'));
    expect(screen.getByTestId('notes')).toHaveTextContent(/^Skutek: dane na cudzych serwerach\.$/);
    expect(screen.getByText('Odwrócono 1 z 2 kart.')).toBeInTheDocument();
    expect(onExplore).toHaveBeenLastCalledWith({ visited: ['dane'], noted: ['dane'] });
    expect(ready.current).toBeNull();
    fireEvent.click(card('Utrata plików'));
    expect(ready.current).not.toBeNull();
    ready.current!();
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['dane', 'pliki'], noted: ['dane'] });
  });

  it('podwójny klik w tej samej klatce: dowód raz, karta wraca na przód; nazwa przycisku z „(obejrzane)”', () => {
    setup();
    const button = card('Dane firmy');
    act(() => {
      button.click();
      button.click();
    });
    expect(screen.getByTestId('notes')).toHaveTextContent(/^Skutek: dane na cudzych serwerach\.$/);
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dane firmy (obejrzane)' })).toBeInTheDocument();
  });

  it('powrót do modułu (stan z serwera): obejrzane karty leżą odwrócone, bez ponownego dowodu; brakująca karta kończy blok', () => {
    const { ready } = setup({ initial: { visited: ['dane'], noted: ['dane'] } });
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'true');
    expect(card('Utrata plików')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    fireEvent.click(card('Utrata plików'));
    expect(ready.current).not.toBeNull();
  });

  it('ilustracja się nie wczytała (B-187): przód z podpisem zamiast pustego pola, karta dalej się obraca', () => {
    setup();
    fireEvent.error(screen.getAllByTestId('flip-card-image')[0]);
    expect(screen.getAllByTestId('flip-card-image')).toHaveLength(1);
    expect(screen.getByTestId('flip-card-fallback')).toHaveTextContent('Dane firmy');
    fireEvent.click(card('Dane firmy'));
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'true');
  });

  it('podgląd ukończonego bloku: karty da się obracać, bez notatek i bez zgłaszania stanu', () => {
    const { onExplore } = setup({ review: true });
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card('Dane firmy'));
    expect(card('Dane firmy')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(onExplore).not.toHaveBeenCalled();
  });
});
