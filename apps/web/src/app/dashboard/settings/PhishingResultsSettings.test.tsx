import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhishingResultsSettings from './PhishingResultsSettings';
import type { PersonalResultsSettings, VisibilityAuditEntry } from '@/lib/phishing-types';

const off: PersonalResultsSettings = { personalResultsEnabled: false, justification: null, changedByEmail: null, updatedAt: null };
const on: PersonalResultsSettings = { personalResultsEnabled: true, justification: 'Weryfikacja skuteczności szkoleń w dziale sprzedaży.', changedByEmail: 'admin@firma.pl', updatedAt: '2027-01-01T10:00:00Z' };
const JUSTIFICATION = 'Weryfikacja skuteczności szkoleń po incydencie w dziale.';

const audit: VisibilityAuditEntry[] = [
  { id: 'a2', action: 'VIEWED', justification: null, campaignId: 'c1', filter: 'PROBLEMS', rowCount: 2, actorEmail: 'admin@firma.pl', createdAt: '2027-01-02T10:00:00Z' },
  { id: 'a1', action: 'ENABLED', justification: 'Weryfikacja skuteczności szkoleń w dziale sprzedaży.', campaignId: null, filter: null, rowCount: null, actorEmail: 'admin@firma.pl', createdAt: '2027-01-01T10:00:00Z' },
];

afterEach(() => vi.unstubAllGlobals());

describe('PhishingResultsSettings', () => {
  it('domyślnie wyłączone: wyjaśnienie, pole uzasadnienia; przycisk zablokowany do 20 znaków (spacje się nie liczą)', () => {
    render(<PhishingResultsSettings initial={off} initialAudit={[]} />);

    expect(screen.getByText('wyłączone')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Włącz wyniki osobowe' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Uzasadnienie włączenia/), { target: { value: `${' '.repeat(30)}krótko` } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Uzasadnienie włączenia/), { target: { value: JUSTIFICATION } });
    expect(button).toBeEnabled();
    expect(screen.getByText('Brak wpisów.')).toBeInTheDocument();
  });

  it('włączenie: POST z uzasadnieniem, stan i dziennik odświeżone z API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => on })
      .mockResolvedValueOnce({ ok: true, json: async () => audit });
    vi.stubGlobal('fetch', fetchMock);
    render(<PhishingResultsSettings initial={off} initialAudit={[]} />);

    fireEvent.change(screen.getByLabelText(/Uzasadnienie włączenia/), { target: { value: `  ${JUSTIFICATION}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Włącz wyniki osobowe' }));

    expect(await screen.findByText('włączone')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/phishing/results/settings/personal-results');
    expect(JSON.parse(init.body)).toEqual({ enabled: true, justification: JUSTIFICATION });
    expect(await screen.findByText('Wgląd w wyniki osobowe')).toBeInTheDocument();
    expect(screen.getByText(/Weryfikacja skuteczności szkoleń w dziale sprzedaży/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyłącz wyniki osobowe' })).toBeInTheDocument();
  });

  it('wyłączenie: POST bez uzasadnienia', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => off })
      .mockResolvedValueOnce({ ok: true, json: async () => audit });
    vi.stubGlobal('fetch', fetchMock);
    render(<PhishingResultsSettings initial={on} initialAudit={audit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Wyłącz wyniki osobowe' }));

    await waitFor(() => expect(screen.getByText('wyłączone')).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ enabled: false });
  });

  it('błąd API jest pokazany, a stan się nie zmienia', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: ['Uzasadnienie jest za krótkie.'] }) }));
    render(<PhishingResultsSettings initial={off} initialAudit={[]} />);

    fireEvent.change(screen.getByLabelText(/Uzasadnienie włączenia/), { target: { value: JUSTIFICATION } });
    fireEvent.click(screen.getByRole('button', { name: 'Włącz wyniki osobowe' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Uzasadnienie jest za krótkie.');
    expect(screen.getByText('wyłączone')).toBeInTheDocument();
  });

  it('dziennik dostępu: akcje, aktor, uzasadnienie', () => {
    render(<PhishingResultsSettings initial={on} initialAudit={audit} />);

    expect(screen.getByText('Włączono wyniki osobowe')).toBeInTheDocument();
    expect(screen.getByText('Wgląd w wyniki osobowe')).toBeInTheDocument();
    expect(screen.getAllByText(/admin@firma.pl/).length).toBeGreaterThan(0);
    expect(screen.getByText('Zakres: Nieudane i niepewne, osób: 2')).toBeInTheDocument(); // ślad zakresu i liczby osób
  });
});
