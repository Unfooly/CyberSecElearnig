import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReportForm from './ReportForm';

describe('ReportForm', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const fill = (sender = 'Obcy <obcy@example.test>', subject = 'Faktura') => {
    type(/nadawca/i, sender);
    type(/temat/i, subject);
  };
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Zgłoś wiadomość' }));

  it('przycisk jest nieaktywny, dopóki nie podano nadawcy i tematu', () => {
    render(<ReportForm />);
    const button = screen.getByRole('button', { name: 'Zgłoś wiadomość' });
    expect(button).toBeDisabled();

    type(/nadawca/i, 'a@b.pl');
    expect(button).toBeDisabled();
    type(/temat/i, 'Temat');
    expect(button).toBeEnabled();
  });

  it('przycisk pozostaje nieaktywny dla samych spacji w wymaganych polach', () => {
    render(<ReportForm />);

    fill('   ', '   ');

    expect(screen.getByRole('button', { name: 'Zgłoś wiadomość' })).toBeDisabled();
  });

  it('wysyła pola na /api/threat-reports i dla zgłoszenia prawdziwego pokazuje podziękowanie (bez pochwały za symulację)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', isSimulation: false }) });
    render(<ReportForm />);
    fill();
    type(/treść wiadomości/i, 'Kliknij tutaj');

    submit();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dziękujemy za zgłoszenie'));
    expect(screen.queryByText(/to była symulacja/i)).not.toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/threat-reports');
    expect(JSON.parse(init.body)).toMatchObject({ sender: 'Obcy <obcy@example.test>', subject: 'Faktura', body: 'Kliknij tutaj' });
  });

  it('dla symulacji pokazuje "Brawo - to była symulacja", a przycisk pozwala zgłosić kolejną wiadomość', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', isSimulation: true }) });
    render(<ReportForm />);
    fill();

    submit();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Brawo - to była symulacja'));
    fireEvent.click(screen.getByRole('button', { name: 'Zgłoś kolejną wiadomość' }));
    expect(screen.getByLabelText(/nadawca/i)).toHaveValue('');
  });

  it('błąd API (limit zgłoszeń) pokazuje komunikat z serwera i zachowuje wpisane dane', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ code: 'REPORT_RATE_LIMIT', message: 'Osiągnięto dzienny limit zgłoszeń.' }) });
    render(<ReportForm />);
    fill();

    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Osiągnięto dzienny limit zgłoszeń.'));
    expect(screen.getByLabelText(/temat/i)).toHaveValue('Faktura');
  });

  it('błąd sieci pokazuje komunikat, a nie wyjątek', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<ReportForm />);
    fill();

    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się połączyć z serwerem'));
  });

  it('pola mają limity długości zgodne z API', () => {
    render(<ReportForm />);

    expect(screen.getByLabelText(/nadawca/i)).toHaveAttribute('maxlength', '320');
    expect(screen.getByLabelText(/temat/i)).toHaveAttribute('maxlength', '300');
    expect(screen.getByLabelText(/treść wiadomości/i)).toHaveAttribute('maxlength', '20000');
    expect(screen.getByLabelText(/komentarz/i)).toHaveAttribute('maxlength', '1000');
  });
});
