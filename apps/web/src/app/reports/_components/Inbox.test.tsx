import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminInbox from './AdminInbox';
import DepartmentInbox from './DepartmentInbox';
import ReportDetail from './ReportDetail';
import type { AdminInboxItem, AdminReportDetail } from '@/lib/threat-report-types';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const item = (over: Partial<AdminInboxItem> = {}): AdminInboxItem => ({
  id: 'r1',
  createdAt: '2027-01-01T10:00:00Z',
  status: 'NEW',
  subject: 'Pilna faktura',
  senderText: 'Obcy <obcy@zlosliwa.example>',
  senderDomain: 'zlosliwa.example',
  hasContent: true,
  ...over,
});

const detail = (over: Partial<AdminReportDetail> = {}): AdminReportDetail => ({
  ...item(),
  reporter: { userId: 'u1', name: 'Anna Nowak', email: 'anna@firma.pl' },
  body: '<script>alert(1)</script> Kliknij',
  headers: 'Received: x',
  comment: 'Podejrzane',
  departmentName: 'Sprzedaż',
  events: [],
  views: [],
  viewers: [],
  ...over,
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

describe('skrzynka zgłoszeń (web)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('AdminInbox', () => {
    it('lista: temat jako link do szczegółów, nadawca i status; BEZ treści i bez kolumny zgłaszającego (tożsamość tylko w audytowanych szczegółach)', async () => {
      fetchMock.mockResolvedValue(ok({ items: [item(), item({ id: 'r2', subject: null, senderText: null, status: 'THREAT' })], total: 2, page: 1, pageSize: 25 }));
      render(<AdminInbox />);

      expect(await screen.findByRole('link', { name: 'Pilna faktura' })).toHaveAttribute('href', '/reports/r1');
      expect(screen.queryByRole('columnheader', { name: 'Zgłaszający' })).not.toBeInTheDocument();
      expect(screen.getByText('Obcy <obcy@zlosliwa.example>')).toBeInTheDocument();
      expect(screen.getByText('Zagrożenie', { selector: 'span' })).toBeInTheDocument(); // plakietka statusu (nie opcja filtra)
      expect(screen.getByRole('link', { name: '(treść usunięta po 90 dniach)' })).toBeInTheDocument();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/threat-reports/inbox?page=1&pageSize=25');
    });

    it('filtr statusu pobiera listę od pierwszej strony z wybranym statusem', async () => {
      fetchMock.mockResolvedValue(ok({ items: [], total: 0, page: 1, pageSize: 25 }));
      render(<AdminInbox />);
      await screen.findByText('Brak zgłoszeń w wybranym zakresie.');

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SAFE' } });

      await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/threat-reports/inbox?page=1&pageSize=25&status=SAFE'));
    });

    it('stronicowanie: przyciski poprzednia/następna zależne od liczby stron', async () => {
      fetchMock.mockResolvedValue(ok({ items: [item()], total: 60, page: 1, pageSize: 25 }));
      render(<AdminInbox />);
      await screen.findByText('Strona 1 z 3');

      expect(screen.getByRole('button', { name: 'Poprzednia' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Następna' }));

      await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/threat-reports/inbox?page=2&pageSize=25'));
    });

    it('błąd API i błąd sieci pokazują komunikat (bez tabeli)', async () => {
      fetchMock.mockResolvedValueOnce(fail(403, { message: 'Brak uprawnień do tego zasobu' }));
      const { unmount } = render(<AdminInbox />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień do tego zasobu');
      unmount();

      fetchMock.mockRejectedValueOnce(new Error('offline'));
      render(<AdminInbox />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się połączyć z serwerem');
    });
  });

  describe('DepartmentInbox (kierownik działu)', () => {
    it('pokazuje datę, DOMENĘ nadawcy, powiązanie z symulacją i status - bez tematu, pełnego nadawcy, zgłaszającego i linków do szczegółów', async () => {
      fetchMock.mockResolvedValue(
        ok({
          items: [
            { id: 'r1', createdAt: '2027-01-01T10:00:00Z', status: 'IN_REVIEW', senderDomain: 'x.example', isSimulation: false },
            { id: 'r2', createdAt: '2027-01-01T11:00:00Z', status: null, senderDomain: 'symulacje.example', isSimulation: true },
          ],
          total: 2,
          page: 1,
          pageSize: 25,
          insufficientData: false,
          minGroupSize: 3,
        }),
      );
      render(<DepartmentInbox />);

      expect(await screen.findByText('x.example')).toBeInTheDocument();
      expect(screen.getByText('W analizie')).toBeInTheDocument();
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('Nie'); // powiązanie z symulacją: nie
      expect(rows[1]).toHaveTextContent('Tak');
      expect(rows[1]).toHaveTextContent('symulacje.example');
      for (const header of ['Zgłoszono', 'Domena nadawcy', 'Symulacja', 'Status']) {
        expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
      }
      for (const forbidden of ['Zgłaszający', 'Temat i nadawca', 'Temat']) {
        expect(screen.queryByRole('columnheader', { name: forbidden })).not.toBeInTheDocument();
      }
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/threat-reports/department?page=1&pageSize=25');
    });

    it('dział poniżej progu: komunikat "Za mało danych", bez listy', async () => {
      fetchMock.mockResolvedValue(ok({ items: [], total: 0, page: 1, pageSize: 25, insufficientData: true, minGroupSize: 3 }));
      render(<DepartmentInbox />);

      expect(await screen.findByText('Za mało danych')).toBeInTheDocument();
      expect(screen.getByText(/mniejszych niż 3 osoby/)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('pusta lista i błąd API', async () => {
      fetchMock.mockResolvedValueOnce(ok({ items: [], total: 0, page: 1, pageSize: 25, insufficientData: false, minGroupSize: 3 }));
      const { unmount } = render(<DepartmentInbox />);
      expect(await screen.findByText('Brak zgłoszeń z Twojego działu.')).toBeInTheDocument();
      unmount();

      fetchMock.mockResolvedValueOnce(fail(403, { message: 'Brak uprawnień do tego zasobu' }));
      render(<DepartmentInbox />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień');
    });
  });

  describe('ReportDetail (ORG_ADMIN)', () => {
    it('treść zgłoszenia jest wyświetlana jako TEKST (HTML nie jest interpretowany), z nadawcą, zgłaszającym i działem', async () => {
      fetchMock.mockResolvedValue(ok(detail()));
      const { container } = render(<ReportDetail id="r1" />);

      expect(await screen.findByText(/<script>alert\(1\)<\/script> Kliknij/)).toBeInTheDocument();
      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByText('Anna Nowak')).toBeInTheDocument();
      expect(screen.getByText(/dział: Sprzedaż/)).toBeInTheDocument();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/threat-reports/inbox/r1');
    });

    it('zgłoszenie po retencji: informacja o usuniętej treści, bez pól treści', async () => {
      fetchMock.mockResolvedValue(ok(detail({ hasContent: false, subject: null, senderText: null, body: null, headers: null, comment: null })));
      render(<ReportDetail id="r1" />);

      expect(await screen.findByText(/została usunięta po 90 dniach/)).toBeInTheDocument();
      expect(screen.queryByText('Treść wiadomości')).not.toBeInTheDocument();
    });

    it('zmiana statusu wysyła wybrany status i pokazuje odpowiedź serwera (wpis w historii); bieżący status jest nieaktywny', async () => {
      fetchMock.mockResolvedValueOnce(ok(detail()));
      render(<ReportDetail id="r1" />);
      await screen.findByText('Treść wiadomości');
      expect(screen.getByRole('button', { name: 'Nowe' })).toBeDisabled();
      // Odpowiedź akcji: tylko status i historia (bez treści); UI zachowuje treść z wcześniejszego, audytowanego odczytu.
      fetchMock.mockResolvedValueOnce(
        ok({ id: 'r1', status: 'IN_REVIEW', events: [{ id: 'e1', type: 'STATUS_CHANGED', fromStatus: 'NEW', toStatus: 'IN_REVIEW', note: null, actorEmail: 'admin@firma.pl', createdAt: '2027-01-01T11:00:00Z' }] }),
      );

      fireEvent.click(screen.getByRole('button', { name: 'W analizie' }));

      await screen.findByText(/admin@firma.pl/);
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe('/api/threat-reports/inbox/r1/status');
      expect(JSON.parse(init.body)).toEqual({ status: 'IN_REVIEW' });
      expect(screen.getByRole('button', { name: 'W analizie' })).toBeDisabled();
      expect(screen.getByText(/<script>alert\(1\)<\/script> Kliknij/)).toBeInTheDocument(); // treść nadal widoczna (nie zniknęła po akcji)
    });

    it('konflikt statusu (409): komunikat i ponowne pobranie aktualnego stanu', async () => {
      fetchMock.mockResolvedValueOnce(ok(detail()));
      render(<ReportDetail id="r1" />);
      await screen.findByText('Treść wiadomości');
      fetchMock.mockResolvedValueOnce(fail(409, { code: 'STATUS_CONFLICT', message: 'Status zgłoszenia został w międzyczasie zmieniony. Odśwież widok.' }));
      fetchMock.mockResolvedValueOnce(ok(detail({ status: 'THREAT' })));

      fireEvent.click(screen.getByRole('button', { name: 'Bezpieczne' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('w międzyczasie zmieniony');
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Zagrożenie' })).toBeDisabled());
    });

    it('notatka: przycisk nieaktywny dla pustej; po dodaniu pole jest czyszczone, a wpis widać w historii (z autorem)', async () => {
      fetchMock.mockResolvedValueOnce(ok(detail()));
      render(<ReportDetail id="r1" />);
      await screen.findByText('Treść wiadomości');
      const add = screen.getByRole('button', { name: 'Dodaj notatkę' });
      expect(add).toBeDisabled();
      fetchMock.mockResolvedValueOnce(ok({ id: 'r1', status: 'NEW', events: [{ id: 'e2', type: 'NOTE_ADDED', fromStatus: null, toStatus: null, note: 'Zweryfikowane z dostawcą', actorEmail: 'admin@firma.pl', createdAt: '2027-01-01T11:00:00Z' }] }));

      fireEvent.change(screen.getByLabelText('Nowa notatka'), { target: { value: 'Zweryfikowane z dostawcą' } });
      fireEvent.click(add);

      expect(await screen.findByText('Zweryfikowane z dostawcą', { selector: 'div' })).toBeInTheDocument();
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ note: 'Zweryfikowane z dostawcą' });
      expect(screen.getByLabelText('Nowa notatka')).toHaveValue('');
    });

    it('pokazuje dziennik wglądów (kto i kiedy) z informacją, że każde otwarcie jest zapisywane', async () => {
      fetchMock.mockResolvedValue(
        ok(
          detail({
            views: [{ id: 'v2', actorEmail: 'drugi@firma.pl', createdAt: '2027-01-02T10:00:00Z' }],
            viewers: [
              { actorEmail: 'drugi@firma.pl', count: 1, firstAt: '2027-01-02T10:00:00Z', lastAt: '2027-01-02T10:00:00Z' },
              { actorEmail: 'admin@firma.pl', count: 57, firstAt: '2027-01-01T10:00:00Z', lastAt: '2027-01-01T12:00:00Z' },
            ],
          }),
        ),
      );
      render(<ReportDetail id="r1" />);

      expect(await screen.findByText('Wglądy w to zgłoszenie')).toBeInTheDocument();
      expect(screen.getByText(/jest zapisywane: kto i kiedy/)).toBeInTheDocument();
      // Podsumowanie per admin (z licznikiem) pokazuje też wglądy, których nie ma już na liście "ostatnich".
      expect(screen.getByText(/wglądów: 57/)).toBeInTheDocument();
      expect(screen.getAllByText(/drugi@firma.pl/).length).toBeGreaterThan(0);
      expect(screen.getByText(/admin@firma.pl/)).toBeInTheDocument();
    });

    it('notatka po retencji pokazuje informację zamiast treści; 404 to komunikat "Nie znaleziono"', async () => {
      fetchMock.mockResolvedValueOnce(ok(detail({ events: [{ id: 'e2', type: 'NOTE_ADDED', fromStatus: null, toStatus: null, note: null, actorEmail: 'admin@firma.pl', createdAt: '2027-01-01T11:00:00Z' }] })));
      const { unmount } = render(<ReportDetail id="r1" />);
      expect(await screen.findByText(/treść notatki usunięta po 90 dniach/)).toBeInTheDocument();
      unmount();

      fetchMock.mockResolvedValueOnce(fail(404, { message: 'Nie znaleziono zgłoszenia.' }));
      render(<ReportDetail id="brak" />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Nie znaleziono zgłoszenia.');
      expect(screen.getByRole('link', { name: /Wróć do listy/ })).toHaveAttribute('href', '/reports');
    });
  });
});
