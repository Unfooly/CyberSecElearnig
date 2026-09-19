import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from './page';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Anna' } });
  fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Nowak' } });
  fireEvent.change(screen.getByLabelText('Służbowy adres e-mail'), { target: { value: 'anna@acme.pl' } });
  fireEvent.change(screen.getByLabelText('Pełna nazwa firmy'), { target: { value: 'Acme Sp. z o.o.' } });
  fireEvent.change(screen.getByLabelText('Nazwa wyświetlana'), { target: { value: 'Acme' } });
  fireEvent.change(screen.getByLabelText('NIP'), { target: { value: '526-025-02-74' } });
  fireEvent.change(screen.getByLabelText('Ulica i numer'), { target: { value: 'ul. Długa 5' } });
  fireEvent.change(screen.getByLabelText('Kod pocztowy'), { target: { value: '80-001' } });
  fireEvent.change(screen.getByLabelText('Miejscowość'), { target: { value: 'Gdańsk' } });
}

function acceptConsents() {
  fireEvent.click(screen.getByLabelText(/Akceptuję/));
  fireEvent.click(screen.getByLabelText(/Zapoznałem/));
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /załóż konto firmy/i }));

describe('RegisterPage', () => {
  it('formularz NIE ma pól hasła (hasło ustawia się po weryfikacji skrzynki)', () => {
    render(<RegisterPage />);

    expect(screen.queryByLabelText(/hasło/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('ma wszystkie pola: administrator, firma, kraj PL (tylko do odczytu)', () => {
    render(<RegisterPage />);

    for (const label of [
      'Imię',
      'Nazwisko',
      'Służbowy adres e-mail',
      'Pełna nazwa firmy',
      'Nazwa wyświetlana',
      'NIP',
      'Ulica i numer',
      'Kod pocztowy',
      'Miejscowość',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Kraj')).toHaveValue('Polska');
    expect(screen.getByLabelText('Kraj')).toHaveAttribute('readonly');
  });

  it('blokuje wysyłkę przy pustym formularzu i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    submit();

    expect(await screen.findByText('Podaj imię.')).toBeInTheDocument();
    expect(screen.getByText('Podaj NIP.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waliduje sumę kontrolną NIP i format kodu pocztowego', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);
    fillValidForm();
    acceptConsents();
    fireEvent.change(screen.getByLabelText('NIP'), { target: { value: '5260250275' } });
    fireEvent.change(screen.getByLabelText('Kod pocztowy'), { target: { value: '00001' } });

    submit();

    expect(await screen.findByText('Podaj poprawny NIP (10 cyfr).')).toBeInTheDocument();
    expect(screen.getByText('Kod pocztowy w formacie 00-000.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waliduje długości i wzorzec imienia zgodnie z RegisterDto (bez wizyty na serwerze)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);
    fillValidForm();
    acceptConsents();
    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Anna123' } });
    fireEvent.change(screen.getByLabelText('Pełna nazwa firmy'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Ulica i numer'), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText('Miejscowość'), { target: { value: 'x'.repeat(121) } });

    submit();

    expect(await screen.findByText(/Dozwolone tylko litery/)).toBeInTheDocument();
    expect(screen.getByText('Wpisz co najmniej 2 znaki.')).toBeInTheDocument();
    expect(screen.getByText('Wpisz co najmniej 3 znaki.')).toBeInTheDocument();
    expect(screen.getByText('Maksymalnie 120 znaków.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('po nieudanej walidacji fokus trafia na pierwsze błędne pole', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<RegisterPage />);

    submit();

    await screen.findByText('Podaj imię.');
    expect(screen.getByLabelText('Imię')).toHaveFocus();
  });

  it('błąd zgód jest powiązany z checkboxami (aria-describedby)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<RegisterPage />);
    fillValidForm();

    submit();

    await screen.findByText(/zaakceptuj Regulamin/i);
    expect(screen.getByLabelText(/Akceptuję/)).toHaveAttribute('aria-describedby', 'consents-error');
  });

  it('bez obu zgód nie wysyła i pokazuje komunikat', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);
    fillValidForm();
    fireEvent.click(screen.getByLabelText(/Akceptuję/)); // tylko regulamin

    submit();

    expect(await screen.findByText(/zaakceptuj Regulamin i potwierdź/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('linki do regulaminu i polityki prywatności prowadzą do właściwych stron', () => {
    render(<RegisterPage />);

    expect(screen.getByRole('link', { name: 'Regulamin' })).toHaveAttribute('href', '/regulamin');
    expect(screen.getByRole('link', { name: 'Polityką prywatności' })).toHaveAttribute('href', '/polityka-prywatnosci');
  });

  it('wysyła dane (bez hasła i kraju) i pokazuje ekran "sprawdź skrzynkę" z komunikatem z API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Wysłaliśmy link.' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);
    fillValidForm();
    acceptConsents();

    submit();

    expect(await screen.findByText('Sprawdź skrzynkę e-mail')).toBeInTheDocument();
    expect(screen.getByText('Wysłaliśmy link.')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/register');
    const payload = JSON.parse(init.body);
    expect(payload).toEqual({
      firstName: 'Anna',
      lastName: 'Nowak',
      email: 'anna@acme.pl',
      organizationLegalName: 'Acme Sp. z o.o.',
      organizationName: 'Acme',
      taxId: '526-025-02-74',
      addressLine: 'ul. Długa 5',
      postalCode: '80-001',
      city: 'Gdańsk',
      acceptTerms: true,
      acceptPrivacyPolicy: true,
    });
    expect(payload).not.toHaveProperty('password');
  });

  it('błąd z API (np. domena publiczna) jest pokazany w formularzu, dane zostają', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Wymagany jest służbowy adres e-mail w domenie firmowej.' }) }),
    );
    render(<RegisterPage />);
    fillValidForm();
    acceptConsents();

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('domenie firmowej');
    expect(screen.getByLabelText('Imię')).toHaveValue('Anna');
  });

  it('awaria sieci pokazuje komunikat i odblokowuje przycisk', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    render(<RegisterPage />);
    fillValidForm();
    acceptConsents();

    submit();

    expect(await screen.findByText(/Nie udało się połączyć z serwerem/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /załóż konto firmy/i })).toBeEnabled());
  });
});
