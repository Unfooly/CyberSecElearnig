'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { EMAIL_REGEX } from '@/lib/email';


interface FieldErrors {
  email?: string;
  password?: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showResetSuccess = searchParams.get('reset') === 'success';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
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
    if (!password.trim()) {
      errors.password = 'Podaj hasło.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNeedsVerification(false);
    setResendMessage(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        // Ten sam generyczny komunikat niezależnie od tego, czy e-mail
        // istnieje - apps/api już go nie ujawnia (auth.service.ts), więc
        // front tylko przekazuje treść dalej, nie interpretuje jej.
        setFormError(data?.message ?? 'Logowanie nie powiodło się.');
        setNeedsVerification(data?.code === 'EMAIL_NOT_VERIFIED');
        return;
      }

      const result = await response.json().catch(() => null);
      // Strona startowa zależy od roli (patrz lib/home-path.ts); przyjmujemy
      // tylko ścieżkę względną z własnego BFF.
      const target = typeof result?.redirectTo === 'string' && /^\/[^/]/.test(result.redirectTo) ? result.redirectTo : '/courses';
      router.push(target);
      router.refresh();
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
      <h1 className="mb-6 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Zaloguj się</h1>

      {showResetSuccess && (
        <p role="status" className="mb-4 rounded-btn bg-success-soft px-3 py-2 text-sm font-semibold text-success">
          Hasło zostało zmienione. Zaloguj się nowym hasłem.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink">
            E-mail
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
            autoComplete="current-password"
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

        {formError && (
          <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            {formError}
          </p>
        )}

        {needsVerification && (
          <div className="text-muted">
            <button type="button" onClick={handleResend} className="font-semibold text-accent-ink underline">
              Wyślij link weryfikacyjny ponownie
            </button>
            {resendMessage && (
              <p role="status" className="mt-2 rounded-btn bg-success-soft px-3 py-2 font-semibold text-success">
                {resendMessage}
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="h-10 w-full rounded-btn bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isSubmitting ? 'Logowanie...' : 'Zaloguj się'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="font-semibold text-accent-ink hover:underline">
          Zapomniałeś hasła?
        </Link>
      </p>
      <p className="mt-2 text-center text-muted">
        Nie masz konta?{' '}
        <Link href="/register" className="font-semibold text-accent-ink hover:underline">
          Załóż organizację
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <Suspense fallback={<div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>Ładowanie...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
