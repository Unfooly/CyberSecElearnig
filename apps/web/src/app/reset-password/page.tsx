'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/Logo';

const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  newPassword?: string;
  confirmPassword?: string;
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!newPassword) {
      errors.newPassword = 'Podaj nowe hasło.';
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      errors.newPassword = `Hasło musi mieć min. ${MIN_PASSWORD_LENGTH} znaków.`;
    }
    if (!confirmPassword) {
      errors.confirmPassword = 'Powtórz nowe hasło.';
    } else if (newPassword && confirmPassword !== newPassword) {
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
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!response.ok) {
        // Komunikat przychodzi 1:1 z apps/api - już rozróżnia "już użyty" od
        // "nieprawidłowy/wygasł" (auth.service.ts), front go nie interpretuje.
        const data = await response.json().catch(() => null);
        setFormError(data?.message ?? 'Nie udało się zresetować hasła.');
        return;
      }

      router.push('/login?reset=success');
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
        <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Nieprawidłowy link</h1>
        <p className="mb-6 text-muted">
          Ten link do resetowania hasła jest niekompletny. Poproś o nowy.
        </p>
        <Link href="/forgot-password" className="font-semibold text-accent-ink hover:underline">
          Poproś o nowy link
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>
      <h1 className="mb-6 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Ustaw nowe hasło</h1>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="newPassword" className="mb-1 block text-sm font-semibold text-ink">
            Nowe hasło
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            aria-invalid={Boolean(fieldErrors.newPassword)}
            aria-describedby={fieldErrors.newPassword ? 'new-password-error' : undefined}
          />
          {fieldErrors.newPassword && (
            <p id="new-password-error" className="mt-1 text-sm font-semibold text-danger">
              {fieldErrors.newPassword}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-semibold text-ink">
            Powtórz nowe hasło
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
          {isSubmitting ? 'Zapisywanie...' : 'Ustaw nowe hasło'}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <Suspense fallback={<div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
      <div className="mb-6">
        <Logo variant="dark" height={28} />
      </div>Ładowanie...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
