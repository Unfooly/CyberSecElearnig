import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportUsersModal from './ImportUsersModal';
import type { ImportPreview, ImportSummary } from '@/lib/import-types';

const seatsOk = { limit: 100, used: 10, available: 90, required: 2, missing: 0, ok: true };

function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: 'b1',
    status: 'PROCESSING',
    fileName: 'ludzie.csv',
    delimiter: ';',
    createdAt: '2027-01-01T10:00:00.000Z',
    expiresAt: '2027-01-02T10:00:00.000Z',
    confirmedAt: '2027-01-01T10:05:00.000Z',
    completedAt: null,
    totalRows: 5000,
    validCount: 5000,
    existingCount: 0,
    errorCount: 0,
    skippedEmpty: 0,
    ignoredColumns: [],
    seats: seatsOk,
    progress: {
      accountsCreated: 5000,
      accountsFailed: 0,
      invites: { pending: 4700, sending: 0, sent: 300, failed: 0, skipped: 0 },
      invitesSent: 300,
      invitesTotal: 5000,
      remaining: 4700,
      dailyLimit: 300,
      dailyRemaining: 0,
      restTomorrow: true,
      estimatedCompletionAt: '2027-01-17T12:00:00.000Z',
      done: false,
    },
    ...overrides,
  };
}

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    ...summary({ id: 'p1', status: 'PREVIEW', confirmedAt: null, totalRows: 4, validCount: 2, existingCount: 1, errorCount: 1, progress: null }),
    errors: [{ line: 4, email: 'zly', reason: 'Nieprawidłowy adres e-mail.' }],
    errorsTruncated: false,
    sample: [{ line: 2, email: 'jan@firma.pl', firstName: 'Jan', lastName: 'Kowalski', departmentName: 'Sprzedaż', status: 'VALID', reason: null }],
    ...overrides,
  };
}

const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

function pickFile(name = 'ludzie.csv') {
  const input = screen.getByLabelText('Plik CSV') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['a;b'], name, { type: 'text/csv' })] } });
}

describe('ImportUsersModal', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function route(handlers: Record<string, () => Promise<Response>>) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const handler = handlers[key];
      if (!handler) throw new Error(`nieoczekiwane wywołanie: ${key}`);
      return handler();
    });
  }

  it('bez trwającego importu pokazuje wybór pliku, wskazówkę Excela i szablon', async () => {
    route({ 'GET /api/users/import/latest': () => json(200, { batch: null }) });

    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);

    expect(await screen.findByRole('button', { name: 'Wybierz plik' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /importuj z csv/i })).toBeInTheDocument();
    expect(screen.getByText(/CSV UTF-8 \(rozdzielany przecinkami\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pobierz szablon' })).toBeInTheDocument();
  });

  it('podgląd: liczby, błędy, stan licencji; potwierdzenie przechodzi do postępu i odświeża listę', async () => {
    const onChanged = vi.fn();
    route({
      'GET /api/users/import/latest': () => json(200, { batch: null }),
      'POST /api/users/import/preview': () => json(201, preview()),
      'POST /api/users/import/p1/confirm': () => json(200, summary()),
    });
    render(<ImportUsersModal onClose={() => undefined} onChanged={onChanged} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });

    pickFile();

    expect(await screen.findByText('Nieprawidłowy adres e-mail.')).toBeInTheDocument();
    expect(screen.getByText(/Licencje: wykorzystano 10 z 100/)).toBeInTheDocument();
    expect(screen.getByText('jan@firma.pl')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zaimportuj 2 osób' }));

    expect(await screen.findByText(/Import w toku/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('brak licencji: ostrzeżenie z liczbą braków i linkiem do ustawień, przycisk importu wyłączony', async () => {
    route({
      'GET /api/users/import/latest': () => json(200, { batch: null }),
      'POST /api/users/import/preview': () => json(201, preview({ seats: { limit: 12, used: 11, available: 1, required: 3, missing: 2, ok: false } })),
    });
    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });

    pickFile();

    expect(await screen.findByText(/Brakuje 2 licencji/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ustawieniach' })).toHaveAttribute('href', '/dashboard/settings');
    expect(screen.getByRole('button', { name: /Zaimportuj/ })).toBeDisabled();
  });

  it('409 SEAT_LIMIT przy potwierdzeniu: komunikat z API i link do ustawień; brak przejścia do postępu', async () => {
    route({
      'GET /api/users/import/latest': () => json(200, { batch: null }),
      'POST /api/users/import/preview': () => json(201, preview()),
      'POST /api/users/import/p1/confirm': () => json(409, { code: 'SEAT_LIMIT', message: 'Brakuje 1 licencji.' }),
      'GET /api/users/import/p1': () => json(200, summary({ id: 'p1', status: 'PREVIEW', seats: { limit: 11, used: 10, available: 1, required: 2, missing: 1, ok: false } })),
    });
    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });
    pickFile();
    fireEvent.click(await screen.findByRole('button', { name: /Zaimportuj/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Brakuje 1 licencji.');
    expect(screen.getByRole('link', { name: 'Przejdź do ustawień' })).toHaveAttribute('href', '/dashboard/settings');
    expect(screen.queryByText(/Import w toku/)).not.toBeInTheDocument();
  });

  it('błąd pliku z API (np. Windows-1250) wyświetla dokładną ścieżkę Excela z komunikatu', async () => {
    const hint = 'W Excelu: Plik → Zapisz jako → „CSV UTF-8 (rozdzielany przecinkami)”.';
    route({
      'GET /api/users/import/latest': () => json(200, { batch: null }),
      'POST /api/users/import/preview': () => json(422, { message: `Plik nie jest w UTF-8. ${hint}` }),
    });
    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });

    pickFile();

    expect(await screen.findByRole('alert')).toHaveTextContent(hint);
  });

  it('plik powyżej 1 MB jest odrzucany po stronie UI bez wysyłania', async () => {
    route({ 'GET /api/users/import/latest': () => json(200, { batch: null }) });
    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'duzy.csv', { type: 'text/csv' });

    fireEvent.change(screen.getByLabelText('Plik CSV'), { target: { files: [big] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/za duży/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('trwający import: "wysłano X z Y, reszta jutro", limit dobowy i szacowana data; można zatrzymać wysyłkę po potwierdzeniu', async () => {
    route({
      'GET /api/users/import/latest': () => json(200, { batch: summary() }),
      'POST /api/users/import/b1/stop': () => json(200, summary({ status: 'COMPLETED', completedAt: '2027-01-01T11:00:00.000Z' })),
    });
    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);

    expect(await screen.findByText(/Import w toku/)).toBeInTheDocument();
    expect(screen.getByText(/Wysłano/).textContent).toMatch(/Wysłano 300 z 5000 zaproszeń, reszta jutro/);
    expect(screen.getByText(/limitu 300 zaproszeń/)).toBeInTheDocument();
    expect(screen.getByText(/Szacowane zakończenie/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
    expect(screen.getByRole('link', { name: 'Pobierz raport CSV' })).toHaveAttribute('href', '/api/users/import/b1/report');

    fireEvent.click(screen.getByRole('button', { name: 'Zatrzymaj wysyłkę' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tak, zatrzymaj' }));

    expect(await screen.findByText('Import zakończony')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nowy import' })).toBeInTheDocument();
  });

  it('anulowanie podglądu woła DELETE i wraca do wyboru pliku', async () => {
    route({
      'GET /api/users/import/latest': () => json(200, { batch: null }),
      'POST /api/users/import/preview': () => json(201, preview()),
      'DELETE /api/users/import/p1': () => json(200, {}),
    });
    render(<ImportUsersModal onClose={() => undefined} onChanged={() => undefined} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });
    pickFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Anuluj import' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Wybierz plik' })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/users/import/p1', { method: 'DELETE' });
  });

  it('Escape zamyka kreator', async () => {
    route({ 'GET /api/users/import/latest': () => json(200, { batch: null }) });
    const onClose = vi.fn();
    render(<ImportUsersModal onClose={onClose} onChanged={() => undefined} />);
    await screen.findByRole('button', { name: 'Wybierz plik' });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
