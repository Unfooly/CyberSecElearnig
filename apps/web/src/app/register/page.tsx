'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { EMAIL_REGEX } from '@/lib/email';

// Dokładnie to, co wymusza backend (RegisterDto: @MinLength(8)) - nie
// zmyślamy dodatkowych reguł (wielkie litery/cyfry), których backend nie
// egzekwuje.
const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registeredMessage, setRegisteredMessage] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(true);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function handleResend() {
    setResendMessage(null);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => null);
      setResendMessage(data?.message ?? 'Nie udało się wysłać linku. Spróbuj ponownie później.');
    } catch {
      setResendMessage('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    }
  }

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!email.trim()) {
      errors.email = 'Podaj adres e-mail.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Podaj poprawny adres e-mail.';
    }
    if (!password) {
      errors.password = 'Podaj hasło.';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Hasło musi mieć min. ${MIN_PASSWORD_LENGTH} znaków.`;
    }
    if (!confirmPassword) {
      errors.confirmPassword = 'Powtórz hasło.';
    } else if (password && confirmPassword !== password) {
      errors.confirmPassword = 'Hasła nie są identyczne.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        // Komunikat przechodzi 1:1 z apps/api - już jest generyczny dla
        // duplikatu e-maila (REGISTRATION_FAILED_MESSAGE), nie ujawnia
        // które konto istnieje.
        const data = await response.json().catch(() => null);
        setFormError(data?.message ?? 'Rejestracja nie powiodła się.');
        return;
      }

      // /auth/register NIE loguje - konto czeka na potwierdzenie adresu
      // e-mail (link w wiadomości), dopiero potem można się zalogować.
      const data = await response.json().catch(() => null);
      setEmailSent(data?.emailSent !== false);
      setRegisteredMessage(
        data?.message ?? 'Wysłaliśmy link weryfikacyjny na podany adres e-mail.',
      );
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (registeredMessage) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
          <h1 className="mb-2 text-2xl font-semibold text-slate-900">Sprawdź skrzynkę e-mail</h1>
          <p
            role={emailSent ? 'status' : 'alert'}
            className={`mb-6 rounded px-3 py-2 text-sm ${
              emailSent ? 'text-slate-600' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {registeredMessage}
          </p>
          {!emailSent && (
            <div className="mb-6 text-sm">
              <button type="button" onClick={handleResend} className="font-medium text-slate-900 underline">
                Wyślij link ponownie
              </button>
              {resendMessage && (
                <p role="status" className="mt-2 rounded bg-green-50 px-3 py-2 text-green-700">
                  {resendMessage}
                </p>
              )}
            </div>
          )}
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            Przejdź do logowania
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Załóż organizację</h1>
        <p className="mb-6 text-sm text-slate-600">
          Nazwę organizacji ustawimy na podstawie domeny Twojego adresu e-mail.
        </p>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              E-mail admina
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {fieldErrors.email && (
              <p id="email-error" className="mt-1 text-sm text-red-600">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              Hasło
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            {fieldErrors.password && (
              <p id="password-error" className="mt-1 text-sm text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
              Powtórz hasło
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={fieldErrors.confirmPassword ? 'confirm-password-error' : undefined}
            />
            {fieldErrors.confirmPassword && (
              <p id="confirm-password-error" className="mt-1 text-sm text-red-600">
                {fieldErrors.confirmPassword}
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
            {isSubmitting ? 'Zakładanie konta...' : 'Załóż organizację'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Masz już konto?{' '}
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            Zaloguj się
          </Link>
        </p>
      </div>
    </main>
  );
}
