import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResellersPanel from './ResellersPanel';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const RESELLERS = [
  { id: 'res-1', name: 'IT Partner', createdAt: '2026-09-22T10:00:00.000Z', clientCount: 1 },
  { id: 'res-2', name: 'MSP Kowalski', createdAt: '2026-09-22T11:00:00.000Z', clientCount: 0 },
];

const ORGANIZATIONS = [
  { id: 'org-1', name: 'Klient z opiekunem', status: 'ACTIVE' as const, resellerId: 'res-1', resellerName: 'IT Partner' },
  { id: 'org-2', name: 'Klient bez opiekuna', status: 'ACTIVE' as const, resellerId: null, resellerName: null },
];

function renderPanel() {
  return render(<ResellersPanel initialResellers={RESELLERS} initialOrganizations={ORGANIZATIONS} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  refreshMock.mockClear();
});

describe('ResellersPanel (panel operatora)', () => {
  it('pokazuje partnerów z liczbą klientów i organizacje z opiekunem albo bez', () => {
    renderPanel();

    // "IT Partner" występuje w kilku miejscach (tabela partnerów, lista wyboru, kolumna opiekuna).
    expect(screen.getAllByText('IT Partner').length).toBeGreaterThan(0);
    expect(screen.getByText('Klient z opiekunem')).toBeInTheDocument();
    expect(screen.getByText('bez opiekuna')).toBeInTheDocument();
  });

  it('zakłada partnera przez POST /api/resellers i odświeża dane z serwera', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'res-3' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Nazwa firmy'), { target: { value: 'Nowy Partner' } });
    fireEvent.change(screen.getByLabelText('E-mail administratora'), { target: { value: 'anna@partner.test' } });
    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Nowak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Załóż partnera' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/resellers');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Nowy Partner',
      adminEmail: 'anna@partner.test',
      adminFirstName: 'Anna',
      adminLastName: 'Nowak',
    });
  });

  it('przypisuje organizację bez opiekuna do wybranego partnera', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Partner'), { target: { value: 'res-2' } });
    fireEvent.change(screen.getByLabelText('Organizacja bez opiekuna'), { target: { value: 'org-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/resellers/res-2/organizations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ organizationId: 'org-2' });
  });

  it('do przypisania proponuje WYŁĄCZNIE organizacje bez opiekuna (jeden opiekun na klienta)', () => {
    renderPanel();

    const options = Array.from(screen.getByLabelText('Organizacja bez opiekuna').querySelectorAll('option')).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['Wybierz organizację', 'Klient bez opiekuna']);
  });

  it('odłącza organizację od partnera', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Odłącz' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/resellers/res-1/organizations/org-1', { method: 'DELETE' });
  });

  it('organizacja bez opiekuna nie ma przycisku odłączenia', () => {
    renderPanel();

    expect(screen.getAllByRole('button', { name: 'Odłącz' })).toHaveLength(1);
  });

  it('błąd z API pokazuje komunikat i nie odświeża danych', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Ta organizacja ma już przypisanego resellera.' }) }),
    );
    renderPanel();

    fireEvent.change(screen.getByLabelText('Organizacja bez opiekuna'), { target: { value: 'org-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ta organizacja ma już przypisanego resellera.');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('awaria sieci kończy się komunikatem, a nie wywróceniem panelu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Odłącz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
  });
});
