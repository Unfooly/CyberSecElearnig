import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DialogueBlock from './DialogueBlock';
import { NotesProvider } from '../player/notes';
import { EvidenceProvider } from '../player/evidence';
import { MascotReactionProvider } from '../player/mascot-reaction';
import { SfxProvider, SFX_VOLUME, __setGestureSeenForTests } from '@/lib/sfx';
import type { ContentBlock } from '@/lib/courses-types';

// Dźwięki czatu (D-087): msg-send przy pytaniu, msg-receive przy każdej kwestii; głośność 0.35; nic przy wyłączonym Lektorze, przed
// pierwszym gestem i w podglądzie ukończonego bloku.

const dialogue: ContentBlock = {
  type: 'DIALOGUE',
  id: 'rozmowa',
  character: { name: 'Anna', role: 'Księgowa' },
  questions: [{ id: 'q1', text: 'Skąd ten mail?', lines: [{ text: 'Przyszedł rano.' }, { text: 'Kliknęłam.' }], required: true }],
};

function renderChat({ enabled = true, review = false }: { enabled?: boolean; review?: boolean } = {}) {
  render(
    <SfxProvider enabled={enabled}>
      <NotesProvider initial={[]}>
        <EvidenceProvider summary={undefined}>
          <MascotReactionProvider resetKey="k">
            <DialogueBlock block={dialogue} contentBase="/content" onSubmit={() => {}} onReady={() => {}} review={review} />
          </MascotReactionProvider>
        </EvidenceProvider>
      </NotesProvider>
    </SfxProvider>,
  );
}

describe('DialogueBlock: dźwięki', () => {
  let played: { src: string; volume: number }[];
  beforeEach(() => {
    vi.useFakeTimers();
    played = [];
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      played.push({ src: this.src, volume: this.volume });
      return Promise.resolve();
    });
    __setGestureSeenForTests(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __setGestureSeenForTests(false);
  });

  it('pytanie = msg-send, każda kwestia = msg-receive, głośność 0.35', () => {
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(played.map((p) => p.src.replace(/^.*\/sfx\//, ''))).toEqual(['msg-send.mp3', 'msg-receive.mp3', 'msg-receive.mp3']);
    expect(played.every((p) => p.volume === SFX_VOLUME)).toBe(true);
  });

  it('Lektor wyłączony - cisza', () => {
    renderChat({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(played).toEqual([]);
  });

  it('podgląd ukończonego bloku - bez dźwięków (i bez opóźnień)', () => {
    renderChat({ review: true });
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    expect(screen.getByText('Kliknęłam.')).toBeInTheDocument();
    expect(played).toEqual([]);
  });

  it('przed pierwszym gestem na stronie - cisza (przeglądarka i tak by odrzuciła)', () => {
    __setGestureSeenForTests(false);
    renderChat();
    screen.getByRole('button', { name: 'Skąd ten mail?' }).click();
    expect(played).toEqual([]);
  });
});
