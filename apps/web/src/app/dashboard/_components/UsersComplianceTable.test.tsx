import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UsersComplianceTable from './UsersComplianceTable';

const row = (over: Record<string, unknown>) => ({
  id: 'u1',
  firstName: 'Jan',
  lastName: 'Kowalski',
  email: 'jan@firma.pl',
  departmentId: 'd1',
  departmentName: 'IT',
  completedMandatoryCoursesCount: 2,
  totalMandatoryCoursesCount: 2,
  completionPercentage: 100,
  complianceStatus: 'COMPLIANT',
  lastActivityAt: null,
  ...over,
});

function stubFetch(items: unknown[], total = items.length) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items, total, page: 1, pageSize: 10 }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const lastUrl = (fetchMock: ReturnType<typeof vi.fn>) => new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://x');

describe('UsersComplianceTable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renderuje pracownika z procentem i badge "Zgodny" oraz "Zaległości"', async () => {
    stubFetch([
      row({}),
      row({ id: 'u2', firstName: null, lastName: null, email: 'ola@firma.pl', completionPercentage: 0, complianceStatus: 'OVERDUE' }),
    ]);
    render(<UsersComplianceTable departments={[]} />);

    expect(await screen.findByText('Jan Kowalski')).toBeInTheDocument();
    expect(screen.getByText('jan@firma.pl')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Zgodny')).toBeInTheDocument();
    expect(screen.getByText('ola@firma.pl')).toBeInTheDocument();
    expect(screen.getByText('Zaległości')).toBeInTheDocument();
  });

  it('pokazuje pusty stan i błąd ładowania', async () => {
    stubFetch([]);
    const { unmount } = render(<UsersComplianceTable departments={[]} />);
    expect(await screen.findByRole('heading', { name: 'Nie ma jeszcze kogo raportować' })).toBeInTheDocument();
    unmount();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<UsersComplianceTable departments={[]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się załadować/i);
  });

  it('filtr działu wysyła departmentId i wraca na stronę 1', async () => {
    const fetchMock = stubFetch([row({})]);
    render(<UsersComplianceTable departments={[{ id: 'd1', name: 'IT' }]} />);
    await screen.findByText('Jan Kowalski');

    fireEvent.change(screen.getByLabelText('Filtruj po dziale'), { target: { value: 'd1' } });

    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('departmentId')).toBe('d1'));
    expect(lastUrl(fetchMock).searchParams.get('page')).toBe('1');
  });

  it('wyszukiwanie jest debounce\'owane i wysyła search', async () => {
    const fetchMock = stubFetch([row({})]);
    render(<UsersComplianceTable departments={[]} />);
    await screen.findByText('Jan Kowalski');

    fireEvent.change(screen.getByLabelText('Szukaj pracownika'), { target: { value: 'kowal' } });

    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('search')).toBe('kowal'));
  });

  it('klik w nagłówek zmienia sortowanie, drugi klik odwraca kierunek', async () => {
    const fetchMock = stubFetch([row({})]);
    render(<UsersComplianceTable departments={[]} />);
    await screen.findByText('Jan Kowalski');

    fireEvent.click(screen.getByRole('button', { name: 'Postęp' }));
    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('sortBy')).toBe('completion'));
    expect(lastUrl(fetchMock).searchParams.get('sortDir')).toBe('desc');

    fireEvent.click(screen.getByRole('button', { name: /Postęp/ }));
    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('sortDir')).toBe('asc'));
  });

  it('paginacja: "Następna" prosi o stronę 2, gdy jest więcej niż jedna strona', async () => {
    const fetchMock = stubFetch([row({})], 25);
    render(<UsersComplianceTable departments={[]} />);
    await screen.findByText('Jan Kowalski');
    expect(screen.getByText(/Strona 1 z 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Następna' }));

    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('page')).toBe('2'));
  });
});
