import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignResults from './CampaignResults';
import type { PersonResult, ResultsView } from '@/lib/phishing-types';

const row = (over: Partial<ResultsView['departments'][number]>) => ({
  kind: 'DEPARTMENT' as const,
  departmentId: 'd1',
  name: 'Sprzedaż',
  insufficientData: false,
  delivered: 5,
  clicked: 2,
  submitted: 1,
  clickRate: 40,
  submitRate: 20,
  ...over,
});

const view: ResultsView = {
  scope: 'ORGANIZATION',
  minGroupSize: 3,
  campaign: { id: 'c1', name: 'Kampania', status: 'COMPLETED', windowStart: '2027-01-01T08:00:00Z', windowEnd: '2027-01-01T16:00:00Z' },
  campaignsCount: 1,
  total: row({ kind: 'ALL', departmentId: null, name: 'Cała organizacja', delivered: 12, clicked: 6, clickRate: 50 }),
  departments: [row({}), row({ kind: 'OTHER', departmentId: null, name: 'Pozostałe działy (za mało osób w pojedynczych działach)', delivered: 3, clicked: 3, clickRate: 100 })],
};

const person = (over: Partial<PersonResult>): PersonResult => ({
  userId: 'u1', name: 'Anna Nowak', email: 'anna@firma.pl', departmentName: 'Sprzedaż', delivery: 'SENT', failureCode: null, sentAt: '2027-01-01T09:00:00Z', clickedAt: '2027-01-01T09:05:00Z', submittedAt: null, ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('CampaignResults', () => {
  it('agregaty per dział: procenty, wiersz zbiorczy, link CSV; ukryty dział pokazany jako "Za mało danych" bez liczb', () => {
    render(
      <CampaignResults
        campaignId="c1"
        view={{ ...view, departments: [...view.departments, row({ name: 'IT', insufficientData: true, delivered: null, clicked: null, submitted: null, clickRate: null, submitRate: null })] }}
        personalResultsEnabled={false}
      />,
    );

    expect(screen.getByText('Cała organizacja')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText(/Pozostałe działy/, { selector: 'td' })).toBeInTheDocument();
    const itRow = screen.getByText('IT').closest('tr') as HTMLElement;
    expect(itRow).toHaveTextContent('Za mało danych');
    expect(itRow).not.toHaveTextContent('%');
    expect(screen.getByRole('link', { name: 'Pobierz CSV' })).toHaveAttribute('href', '/api/phishing/results/campaigns/c1/departments.csv');
  });

  it('wyniki osobowe WYŁĄCZONE: tylko informacja z linkiem do ustawień; nie ma przycisku, listy ani CSV osobowego, nic nie jest pobierane', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CampaignResults campaignId="c1" view={view} personalResultsEnabled={false} />);

    expect(screen.getByText(/domyślnie wyłączone/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ustawieniach' })).toHaveAttribute('href', '/dashboard/settings#wyniki-osobowe');
    expect(screen.queryByRole('button', { name: 'Pokaż wyniki osobowe' })).not.toBeInTheDocument();
    expect(screen.queryByText(/people\.csv/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wyniki osobowe włączone: NIC nie ładuje się samo (wgląd jest audytowany) - dopiero po kliknięciu, z wybranym zakresem', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [person({}), person({ userId: 'u2', name: null, email: 'b@firma.pl', delivery: 'UNCERTAIN', failureCode: 'TIMEOUT_UNKNOWN', clickedAt: null })] });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampaignResults campaignId="c1" view={view} personalResultsEnabled />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/zapisywany w dzienniku audytu/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Zakres'), { target: { value: 'PROBLEMS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż wyniki osobowe' }));

    expect(await screen.findByText('Anna Nowak')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/phishing/results/campaigns/c1/people?filter=PROBLEMS');
    expect(screen.getByText('b@firma.pl')).toBeInTheDocument(); // brak imienia: pokazujemy e-mail
    expect(screen.getByText('Niepewne')).toBeInTheDocument();
    expect(screen.getByText(/dostawca mógł wysłać wiadomość/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pobierz CSV (audytowane)' })).toHaveAttribute('href', '/api/phishing/results/campaigns/c1/people.csv?filter=PROBLEMS');
  });

  it('zmiana zakresu czyści starą listę (nie pokazujemy wyników innego filtra); flaga wyłączona w międzyczasie => komunikat, bez listy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [person({})] })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'PERSONAL_RESULTS_DISABLED', message: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampaignResults campaignId="c1" view={view} personalResultsEnabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Pokaż wyniki osobowe' }));
    expect(await screen.findByText('Anna Nowak')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Zakres'), { target: { value: 'CLICKED' } });
    expect(screen.queryByText('Anna Nowak')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż wyniki osobowe' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wyniki osobowe zostały wyłączone.'));
    expect(screen.queryByText('Anna Nowak')).not.toBeInTheDocument();
  });
});
