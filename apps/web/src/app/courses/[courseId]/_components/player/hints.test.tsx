import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { HINT_EVENT_TEXT, HintProvider, useCompleteHint, useHints, type HintMessage } from './hints';

// Przeniesione z mascot-reaction.test.tsx (D-093): te same zasady, tylko bez pozy - liczy się sam tekst.
function Probe() {
  const { hint, notify, show } = useHints();
  return (
    <div>
      <output data-testid="hint">{hint ?? ''}</output>
      <button type="button" onClick={() => notify('evidence')}>zdarzenie</button>
      <button type="button" onClick={() => show({ pose: 'greeting', text: 'Z treści!' })}>pokaż z treści</button>
      <button type="button" onClick={() => show({ pose: 'greeting' })}>sama poza</button>
    </div>
  );
}

describe('hints: notify() (zdarzenia powłoki) i show() (reakcja z treści)', () => {
  afterEach(() => vi.useRealTimers());

  it('notify() pokazuje stały tekst zdarzenia', () => {
    render(
      <HintProvider resetKey="k">
        <Probe />
      </HintProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'zdarzenie' }));
    expect(screen.getByTestId('hint')).toHaveTextContent(HINT_EVENT_TEXT.evidence);
  });

  it('show() pokazuje tekst z treści; poza jest ignorowana', () => {
    render(
      <HintProvider resetKey="k">
        <Probe />
      </HintProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pokaż z treści' }));
    expect(screen.getByTestId('hint')).toHaveTextContent('Z treści!');
    expect(screen.getByTestId('hint')).not.toHaveTextContent('greeting');
  });

  it('reakcja bez tekstu (sama przestarzała poza) nic nie pokazuje', () => {
    render(
      <HintProvider resetKey="k">
        <Probe />
      </HintProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'sama poza' }));
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });

  it('podpowiedź znika po 5 s', () => {
    vi.useFakeTimers();
    render(
      <HintProvider resetKey="k">
        <Probe />
      </HintProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'zdarzenie' }));
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByTestId('hint')).toHaveTextContent(HINT_EVENT_TEXT.evidence);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });

  it('podpowiedź znika po zmianie resetKey (inny widok)', () => {
    function Harness() {
      const [key, setKey] = useState('a');
      return (
        <HintProvider resetKey={key}>
          <Probe />
          <button type="button" onClick={() => setKey('b')}>zmień widok</button>
        </HintProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'pokaż z treści' }));
    expect(screen.getByTestId('hint')).toHaveTextContent('Z treści!');
    fireEvent.click(screen.getByRole('button', { name: 'zmień widok' }));
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });
});

function CompleteProbe({ message, ready, review }: { message?: HintMessage; ready: boolean; review: boolean }) {
  useCompleteHint(message, ready, review);
  return <output data-testid="hint">{useHints().hint ?? ''}</output>;
}

describe('useCompleteHint: reactions.complete (schemaVersion 4), odpalane raz po spełnieniu warunku', () => {
  const message = { pose: 'cheer', text: 'Brawo!' };

  it('nie odpala się, dopóki ready=false', () => {
    render(
      <HintProvider resetKey="k">
        <CompleteProbe message={message} ready={false} review={false} />
      </HintProvider>,
    );
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });

  it('odpala się, gdy ready=true', () => {
    render(
      <HintProvider resetKey="k">
        <CompleteProbe message={message} ready={true} review={false} />
      </HintProvider>,
    );
    expect(screen.getByTestId('hint')).toHaveTextContent('Brawo!');
  });

  it('nigdy nie odpala się w podglądzie ("Wstecz", review=true)', () => {
    render(
      <HintProvider resetKey="k">
        <CompleteProbe message={message} ready={true} review={true} />
      </HintProvider>,
    );
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });

  it('bez reactions.complete w treści nic się nie dzieje', () => {
    render(
      <HintProvider resetKey="k">
        <CompleteProbe message={undefined} ready={true} review={false} />
      </HintProvider>,
    );
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });

  it('odpala się tylko raz: kolejne ready=true (nawet z inną treścią) nie nadpisuje pierwszej reakcji', () => {
    const messageB = { pose: 'warning', text: 'Inna treść' };
    function Harness() {
      const [current, setCurrent] = useState<HintMessage>(message);
      const [ready, setReady] = useState(true);
      return (
        <HintProvider resetKey="k">
          <CompleteProbe message={current} ready={ready} review={false} />
          <button type="button" onClick={() => setReady(false)}>cofnij</button>
          <button
            type="button"
            onClick={() => {
              setCurrent(messageB);
              setReady(true);
            }}
          >
            wróć z inną treścią
          </button>
        </HintProvider>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId('hint')).toHaveTextContent('Brawo!');
    fireEvent.click(screen.getByRole('button', { name: 'cofnij' }));
    fireEvent.click(screen.getByRole('button', { name: 'wróć z inną treścią' }));
    expect(screen.getByTestId('hint')).toHaveTextContent('Brawo!');
  });
});
