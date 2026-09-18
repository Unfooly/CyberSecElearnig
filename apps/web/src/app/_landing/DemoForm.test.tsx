import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DemoForm from './DemoForm';

function fill(email: string, count: string) {
  fireEvent.change(screen.getByLabelText('Służbowy e-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Liczba pracowników'), { target: { value: count } });
}

describe('DemoForm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waliduje pola i nie wysyła żądania przy błędach', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Umów demo' }));
    expect(screen.getByText('Podaj służbowy adres e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Podaj liczbę pracowników.')).toBeInTheDocument();

    fill('nie-email', '1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Umów demo' }));
    expect(screen.getByText('Podaj poprawny adres e-mail.')).toBeInTheDocument();
    expect(screen.getByText(/liczbę całkowitą/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wysyła dane i pokazuje komunikat sukcesu w success-soft, czyszcząc formularz', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ message: 'Dziękujemy!' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoForm />);

    fill('jan@firma.pl', '120');
    fireEvent.click(screen.getByRole('button', { name: 'Umów demo' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Dziękujemy!');
    expect(status).toHaveClass('bg-success-soft');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo-request');
    expect(JSON.parse(init.body)).toEqual({ email: 'jan@firma.pl', employeeCount: 120, website: '' });
    expect(screen.getByLabelText('Służbowy e-mail')).toHaveValue('');
  });

  it('pokazuje komunikat o limicie przy 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    render(<DemoForm />);

    fill('jan@firma.pl', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Umów demo' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Zbyt wiele prób/));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('pole pułapki na boty jest ukryte przed użytkownikiem', () => {
    render(<DemoForm />);

    expect(document.getElementById('demo-website')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
