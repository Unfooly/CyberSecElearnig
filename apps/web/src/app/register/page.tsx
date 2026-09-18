'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
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
      <main className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
          <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Sprawdź skrzynkę e-mail</h1>
          <p
            role={emailSent ? 'status' : 'alert'}
            className={`mb-6 rounded-btn px-3 py-2 ${
              emailSent ? 'text-muted' : 'bg-warning-soft font-semibold text-warning'
            }`}
          >
            {registeredMessage}
          </p>
          {!emailSent && (
            <div className="mb-6 text-sm">
              <button type="button" onClick={handleResend} className="font-semibold text-accent-ink underline">
                Wyślij link ponownie
              </button>
              {resendMessage && (
                <p role="status" className="mt-2 rounded-btn bg-success-soft px-3 py-2 font-semibold text-success">
                  {resendMessage}
                </p>
              )}
            </div>
          )}
          <Link href="/login" className="font-semibold text-accent-ink hover:underline">
            Przejdź do logowania
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
        <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Załóż organizację</h1>
        <p className="mb-6 text-muted">
          Nazwę organizacji ustawimy na podstawie domeny Twojego adresu e-mail.
        </p>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink">
              E-mail admina
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {fieldErrors.email && (
              <p id="email-error" className="mt-1 text-sm font-semibold text-danger">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink">
              Hasło
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            {fieldErrors.password && (
              <p id="password-error" className="mt-1 text-sm font-semibold text-danger">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-semibold text-ink">
              Powtórz hasło
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={fieldErrors.confirmPassword ? 'confirm-password-error' : undefined}
            />
            {fieldErrors.confirmPassword && (
              <p id="confirm-password-error" className="mt-1 text-sm font-semibold text-danger">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-10 w-full rounded-btn bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {isSubmitting ? 'Zakładanie konta...' : 'Załóż organizację'}
          </button>
        </form>

        <p className="mt-6 text-center text-muted">
          Masz już konto?{' '}
          <Link href="/login" className="font-semibold text-accent-ink hover:underline">
            Zaloguj się
          </Link>
        </p>
      </div>
    </main>
  );
}
