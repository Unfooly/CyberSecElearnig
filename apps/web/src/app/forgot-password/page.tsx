'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { EMAIL_REGEX } from '@/lib/email';


// Zawsze ten sam komunikat po wysłaniu formularza, niezależnie od treści
// odpowiedzi backendu - front NIE interpretuje data.message dla sukcesu,
// żeby wzorzec anty-enumeracyjny (auth.service.ts) obowiązywał też wtedy,
// gdyby backendowy tekst kiedyś się zmienił bez zmiany na froncie.
const SUCCESS_MESSAGE =
  'Jeśli podany adres e-mail istnieje w systemie, wysłaliśmy na niego link do zresetowania hasła.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError('Podaj adres e-mail.');
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError('Podaj poprawny adres e-mail.');
      return;
    }
    setEmailError(null);

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      if (!response.ok) {
        // Błędy infrastrukturalne (rate limit, brak połączenia) NIE są
        // enumeracją - dotyczą każdego żądania niezależnie od tego, czy
        // e-mail istnieje, więc bezpiecznie pokazujemy realną treść.
        const data = await response.json().catch(() => null);
        setFormError(data?.message ?? 'Nie udało się wysłać żądania. Spróbuj ponownie później.');
        return;
      }

      setSuccessMessage(SUCCESS_MESSAGE);
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Zapomniałeś hasła?</h1>
        <p className="mb-6 text-sm text-slate-600">
          Podaj adres e-mail, na który wyślemy link do zresetowania hasła.
        </p>

        {successMessage ? (
          <p role="status" className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">
            {successMessage}
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? 'email-error' : undefined}
              />
              {emailError && (
                <p id="email-error" className="mt-1 text-sm text-red-600">
                  {emailError}
                </p>
              )}
            </div>

            {formError && (
              <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Wysyłanie...' : 'Wyślij link do resetu'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            Wróć do logowania
          </Link>
        </p>
      </div>
    </main>
  );
}
