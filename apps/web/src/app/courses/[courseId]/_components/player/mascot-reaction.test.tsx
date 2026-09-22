import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MascotReactionProvider, useCompleteReaction, useMascotReaction } from './mascot-reaction';

function Probe() {
  const { reaction, react, show } = useMascotReaction();
  return (
    <div>
      <output data-testid="pose">{reaction?.pose ?? ''}</output>
      <output data-testid="text">{reaction?.text ?? ''}</output>
      <button type="button" onClick={() => react('evidence')}>zdarzenie</button>
      <button type="button" onClick={() => show({ pose: 'greeting', text: 'Z treści!' })}>pokaż z treści</button>
    </div>
  );
}

describe('mascot-reaction: show() (reakcja z treści bloku, obok stałych zdarzeń react())', () => {
  it('show() ustawia dowolną pozę/tekst z treści, tak jak react() dla zdarzeń powłoki', () => {
    render(
      <MascotReactionProvider resetKey="k">
        <Probe />
      </MascotReactionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pokaż z treści' }));
    expect(screen.getByTestId('pose')).toHaveTextContent('greeting');
    expect(screen.getByTestId('text')).toHaveTextContent('Z treści!');
  });

  it('reakcja zniknie po zmianie resetKey (inny widok)', () => {
    function Harness() {
      const [key, setKey] = useState('a');
      return (
        <MascotReactionProvider resetKey={key}>
          <Probe />
          <button type="button" onClick={() => setKey('b')}>zmień widok</button>
        </MascotReactionProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'pokaż z treści' }));
    expect(screen.getByTestId('pose')).toHaveTextContent('greeting');
    fireEvent.click(screen.getByRole('button', { name: 'zmień widok' }));
    expect(screen.getByTestId('pose')).toHaveTextContent('');
  });
});

function CompleteProbe({ reaction, ready, review }: { reaction?: { pose: string; text: string }; ready: boolean; review: boolean }) {
  useCompleteReaction(reaction, ready, review);
  const { reaction: shown } = useMascotReaction();
  return <output data-testid="pose">{shown?.pose ?? ''}</output>;
}

describe('useCompleteReaction: reactions.complete (schemaVersion 4), odpalane raz po spełnieniu warunku', () => {
  const reaction = { pose: 'cheer', text: 'Brawo!' };

  it('nie odpala się, dopóki ready=false', () => {
    render(
      <MascotReactionProvider resetKey="k">
        <CompleteProbe reaction={reaction} ready={false} review={false} />
      </MascotReactionProvider>,
    );
    expect(screen.getByTestId('pose')).toHaveTextContent('');
  });

  it('odpala się, gdy ready=true', () => {
    render(
      <MascotReactionProvider resetKey="k">
        <CompleteProbe reaction={reaction} ready={true} review={false} />
      </MascotReactionProvider>,
    );
    expect(screen.getByTestId('pose')).toHaveTextContent('cheer');
  });

  it('nigdy nie odpala się w podglądzie ("Wstecz", review=true)', () => {
    render(
      <MascotReactionProvider resetKey="k">
        <CompleteProbe reaction={reaction} ready={true} review={true} />
      </MascotReactionProvider>,
    );
    expect(screen.getByTestId('pose')).toHaveTextContent('');
  });

  it('bez reactions.complete w treści nic się nie dzieje', () => {
    render(
      <MascotReactionProvider resetKey="k">
        <CompleteProbe reaction={undefined} ready={true} review={false} />
      </MascotReactionProvider>,
    );
    expect(screen.getByTestId('pose')).toHaveTextContent('');
  });

  it('odpala się tylko raz: kolejne ready=true (nawet z inną treścią) nie nadpisuje pierwszej reakcji', () => {
    const reactionB = { pose: 'warning', text: 'Inna treść' };
    function Harness() {
      const [current, setCurrent] = useState(reaction);
      const [ready, setReady] = useState(true);
      return (
        <MascotReactionProvider resetKey="k">
          <CompleteProbe reaction={current} ready={ready} review={false} />
          <button type="button" onClick={() => setReady(false)}>cofnij</button>
          <button
            type="button"
            onClick={() => {
              setCurrent(reactionB);
              setReady(true);
            }}
          >
            wróć z inną treścią
          </button>
        </MascotReactionProvider>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId('pose')).toHaveTextContent('cheer');
    fireEvent.click(screen.getByRole('button', { name: 'cofnij' }));
    fireEvent.click(screen.getByRole('button', { name: 'wróć z inną treścią' }));
    expect(screen.getByTestId('pose')).toHaveTextContent('cheer');
  });
});
