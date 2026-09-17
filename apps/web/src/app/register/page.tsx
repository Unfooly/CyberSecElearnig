'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Dokładnie to, co wymusza backend (RegisterDto: @MinLength(8)) - nie
// zmyślamy dodatkowych reguł (wielkie litery/cyfry), których backend nie
// egzekwuje.
const MIN_PASSWORD_LENGTH = 8;
// RegisterDto: @MinLength(2) na organizationName.
const MIN_ORG_NAME_LENGTH = 2;

interface FieldErrors {
  organizationName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!organizationName.trim()) {
      errors.organizationName = 'Podaj nazwę organizacji.';
    } else if (organizationName.trim().length < MIN_ORG_NAME_LENGTH) {
      errors.organizationName = `Nazwa organizacji musi mieć min. ${MIN_ORG_NAME_LENGTH} znaki.`;
    }
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
        body: JSON.stringify({ organizationName: organizationName.trim(), email: email.trim(), password }),
      });

      if (!response.ok) {
        // Komunikat przechodzi 1:1 z apps/api - już jest generyczny dla
        // duplikatu e-maila (REGISTRATION_FAILED_MESSAGE), nie ujawnia
        // które konto istnieje.
        const data = await response.json().catch(() => null);
        setFormError(data?.message ?? 'Rejestracja nie powiodła się.');
        return;
      }

      // /auth/register loguje od razu (zwraca tokeny tak jak /auth/login) -
      // nowo utworzony user ma rolę ORG_ADMIN, zgodną z PROTECTED_ROUTES dla
      // /dashboard w middleware.ts.
      router.push('/dashboard');
      router.refresh();
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">Załóż organizację</h1>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="organizationName" className="mb-1 block text-sm font-medium text-slate-700">
              Nazwa organizacji
            </label>
            <input
              id="organizationName"
              name="organizationName"
              type="text"
              autoComplete="organization"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.organizationName)}
              aria-describedby={fieldErrors.organizationName ? 'organization-name-error' : undefined}
            />
            {fieldErrors.organizationName && (
              <p id="organization-name-error" className="mt-1 text-sm text-red-600">
                {fieldErrors.organizationName}
              </p>
            )}
          </div>

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
            className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
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
