import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TextInputBlock from './TextInputBlock';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';

const block: ContentBlock = {
  type: 'TEXT_INPUT_GUIDED',
  id: 'domena',
  prompt: 'Jaka jest prawdziwa domena w linku?',
  placeholder: 'domena.pl',
  maxAttempts: 3,
  hintCount: 2,
};

const attempt = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ correct: false, attempt: 1, attemptsLeft: 2, done: false, ...over }),
});

function Probe() {
  return <output data-testid="reaction">{useMascotReaction().reaction?.pose ?? ''}</output>;
}

function setup(props: { progress?: ClientProgressBlock; onContinue?: () => void; onProgress?: (p: Partial<ClientProgressBlock>) => void; readOnly?: boolean } = {}) {
  render(
    <MascotReactionProvider resetKey="k">
      <TextInputBlock block={block} courseId="course-1" {...props} />
      <Probe />
    </MascotReactionProvider>,
  );
}

const type = (value: string) => fireEvent.change(screen.getByLabelText('Jaka jest prawdziwa domena w linku?'), { target: { value } });
const check = () => fireEvent.click(screen.getByRole('button', { name: 'Sprawdź' }));

describe('TextInputBlock: zadanie z podpowiedzią (ocena na serwerze)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wysyła próbę na BFF (bez oceny i bez punktów), błędna próba pokazuje podpowiedź, licznik i maskotka "thinking"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(attempt({ hint: { text: 'Spójrz na to, co jest tuż przed pierwszym ukośnikiem.' } }));
    vi.stubGlobal('fetch', fetchMock);
    setup();

    expect(screen.getByText('Próba 1 z 3.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sprawdź' })).toBeDisabled();
    type('  bank.pl ');
    check();

    await screen.findByText('Spójrz na to, co jest tuż przed pierwszym ukośnikiem.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/courses/course-1/blocks/domena/attempt');
    expect(JSON.parse(init.body)).toEqual({ answer: 'bank.pl' });
    expect(screen.getByText('To nie ta odpowiedź. Pozostało prób: 2.')).toBeInTheDocument();
    expect(screen.getByText('Próba 2 z 3 (pozostało: 2).')).toBeInTheDocument();
    expect(screen.getByTestId('reaction')).toHaveTextContent('thinking');
    // Pole czyści się po błędnej próbie (nie zostaje stara odpowiedź).
    expect((screen.getByLabelText('Jaka jest prawdziwa domena w linku?') as HTMLInputElement).value).toBe('');
  });

  it('błędna próba bez podpowiedzi: maskotka "warning"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(attempt()));
    setup();
    type('zle');
    check();
    await screen.findByText(/Pozostało prób: 2/);
    expect(screen.getByTestId('reaction')).toHaveTextContent('warning');
  });

  it('poprawna próba: wynik, brak pola, "Kontynuuj" wywołuje onContinue (zapis postępu)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(attempt({ correct: true, attempt: 2, attemptsLeft: 1, done: true, points: 0.75 })));
    const onContinue = vi.fn();
    const onProgress = vi.fn();
    setup({ onContinue, onProgress });
    type('bank.pl');
    check();

    await screen.findByText(/Poprawna odpowiedź!/);
    expect(screen.getByText(/Wynik: 75%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sprawdź' })).not.toBeInTheDocument();
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ done: true, correct: true, points: 0.75, attempts: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('reaction z treści (schemaVersion 4, reactions.result) po rozstrzygnięciu ma pierwszeństwo nad brakiem reakcji/ogólnym ostrzeżeniem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(attempt({ correct: true, attempt: 1, attemptsLeft: 2, done: true, points: 1, reaction: { pose: 'cheer', text: 'Świetnie!' } })),
    );
    setup({ onContinue: vi.fn() });
    type('bank.pl');
    check();
    await screen.findByText(/Poprawna odpowiedź!/);
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');
  });

  it('wyczerpane próby: rozwiązanie z wyjaśnieniem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(attempt({ attempt: 3, attemptsLeft: 0, done: true, points: 0, solution: { text: 'bank-0.pl', explanation: 'Zero zamiast litery o.' } })),
    );
    setup({ onContinue: vi.fn() });
    type('cos');
    check();
    await screen.findByText('Wykorzystano wszystkie próby.');
    expect(screen.getByText('bank-0.pl')).toBeInTheDocument();
    expect(screen.getByText('Zero zamiast litery o.')).toBeInTheDocument();
  });

  it('błąd 400 z tablicą komunikatów walidatora nie wycieka do UI (stały komunikat po polsku); tekstowy komunikat API jest pokazany', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: ['answer must be a string', 'answer must be shorter'] }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'To zadanie jest już rozstrzygnięte' }) });
    vi.stubGlobal('fetch', fetchMock);
    setup();
    type('a');
    check();
    await screen.findByText('Nie udało się sprawdzić odpowiedzi.');
    expect(screen.queryByText(/must be/)).not.toBeInTheDocument();
    check();
    await screen.findByText('To zadanie jest już rozstrzygnięte');
  });

  it('pole zachowuje fokus podczas wysyłki (readOnly zamiast disabled)', async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve))));
    setup();
    const input = screen.getByLabelText('Jaka jest prawdziwa domena w linku?') as HTMLInputElement;
    input.focus();
    type('a');
    check();
    await waitFor(() => expect(input).toHaveAttribute('readonly'));
    expect(input).not.toBeDisabled();
    expect(input).toHaveFocus();
    finish({ ok: true, status: 200, json: async () => ({ correct: false, attempt: 1, attemptsLeft: 2, done: false }) });
    await screen.findByText(/Pozostało prób: 2/);
    expect(input).not.toHaveAttribute('readonly');
    expect(input).toHaveFocus();
  });

  it('zadanie bez identyfikatora: błąd, żądanie nie jest wysyłane (pusty id nie trafia do adresu)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MascotReactionProvider resetKey="k">
        <TextInputBlock block={{ ...block, id: undefined }} courseId="course-1" />
      </MascotReactionProvider>,
    );
    type('a');
    check();
    expect(screen.getByText(/nie ma identyfikatora/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limit prób (429) i błąd sieci: czytelny komunikat, pole zostaje, można ponowić', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ message: 'ThrottlerException' }) })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    type('a');
    check();
    await screen.findByText(/Zbyt wiele prób w krótkim czasie/);
    expect(screen.queryByText(/ThrottlerException/)).not.toBeInTheDocument();
    check();
    await screen.findByText(/Nie udało się połączyć z serwerem/);
    expect((screen.getByLabelText('Jaka jest prawdziwa domena w linku?') as HTMLInputElement).value).toBe('a');
  });

  it('podwójne wysłanie (Enter i klik w tym samym ticku) daje jedno żądanie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(attempt());
    vi.stubGlobal('fetch', fetchMock);
    setup();
    type('a');
    const form = screen.getByRole('button', { name: 'Sprawdź' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Pozostało prób/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('po odświeżeniu stan wraca z serwera: próby, odsłonięte podpowiedzi; rozstrzygnięte zadanie bez pola', () => {
    setup({ progress: { type: 'TEXT_INPUT_GUIDED', done: false, attempts: 2, revealedHints: [{ text: 'Pierwsza podpowiedź.' }, { text: 'Druga podpowiedź.' }] } });
    expect(screen.getByText('Pierwsza podpowiedź.')).toBeInTheDocument();
    expect(screen.getByText('Druga podpowiedź.')).toBeInTheDocument();
    expect(screen.getByText('Próba 3 z 3 (pozostało: 1).')).toBeInTheDocument();
  });

  it('rozstrzygnięte przed odświeżeniem (poprawnie) => wynik i "Kontynuuj", bez pola', () => {
    setup({ progress: { type: 'TEXT_INPUT_GUIDED', done: true, correct: true, points: 1, attempts: 1 }, onContinue: vi.fn() });
    expect(screen.getByText(/Poprawna odpowiedź!/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Jaka jest prawdziwa domena w linku?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kontynuuj' })).toBeInTheDocument();
  });

  it('podgląd (readOnly): wynik i rozwiązanie, bez pola i bez "Kontynuuj"', () => {
    setup({
      readOnly: true,
      progress: { type: 'TEXT_INPUT_GUIDED', done: true, correct: false, attempts: 3, solution: { text: 'bank-0.pl' } },
      onContinue: vi.fn(),
    });
    expect(screen.getByText('Wykorzystano wszystkie próby.')).toBeInTheDocument();
    expect(screen.getByText('bank-0.pl')).toBeInTheDocument();
    expect(screen.queryByLabelText('Jaka jest prawdziwa domena w linku?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kontynuuj' })).not.toBeInTheDocument();
  });
});
