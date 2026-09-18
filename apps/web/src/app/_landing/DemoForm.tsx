'use client';

import { useState, type FormEvent } from 'react';
import Button from '@/components/ui/Button';
import { EMAIL_REGEX } from '@/lib/email';

interface FieldErrors {
  email?: string;
  employeeCount?: string;
}

const INPUT =
  'h-[46px] w-full rounded-[10px] border border-border bg-surface px-3.5 text-[15px] font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft';

export default function DemoForm() {
  const [email, setEmail] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [website, setWebsite] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): number | null {
    const errors: FieldErrors = {};
    if (!email.trim()) {
      errors.email = 'Podaj służbowy adres e-mail.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Podaj poprawny adres e-mail.';
    }
    const count = Number(employeeCount.trim());
    if (!employeeCount.trim()) {
      errors.employeeCount = 'Podaj liczbę pracowników.';
    } else if (!Number.isInteger(count) || count < 1 || count > 1_000_000) {
      errors.employeeCount = 'Podaj liczbę całkowitą od 1 do 1 000 000.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0 ? count : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const count = validate();
    if (count === null) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), employeeCount: count, website }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(
          response.status === 429
            ? 'Zbyt wiele prób. Spróbuj ponownie za minutę.'
            : Array.isArray(data?.message)
              ? 'Sprawdź poprawność podanych danych.'
              : (data?.message ?? 'Nie udało się wysłać zgłoszenia. Spróbuj ponownie.'),
        );
        return;
      }

      setSuccessMessage(data?.message ?? 'Dziękujemy! Odpiszemy w ciągu 1 dnia roboczego.');
      setEmail('');
      setEmployeeCount('');
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form id="demo" onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 rounded-2xl border border-border bg-paper p-6">
      <b className="text-lg">Zobacz Unfooly na swoich danych</b>
      <span className="text-sm text-muted">20 minut online. Pokażemy dashboard, ścieżkę pracownika i raport.</span>

      {successMessage && (
        <p role="status" className="rounded-btn bg-success-soft px-3 py-2 text-sm font-semibold text-success">
          {successMessage}
        </p>
      )}
      {formError && (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="demo-email" className="text-[13px] font-bold">
          Służbowy e-mail
        </label>
        <input
          id="demo-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="imie@firma.pl"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'demo-email-error' : undefined}
          className={INPUT}
        />
        {fieldErrors.email && (
          <p id="demo-email-error" className="text-sm font-semibold text-danger">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="demo-count" className="text-[13px] font-bold">
          Liczba pracowników
        </label>
        <input
          id="demo-count"
          name="employeeCount"
          type="text"
          inputMode="numeric"
          placeholder="np. 120"
          value={employeeCount}
          onChange={(event) => setEmployeeCount(event.target.value)}
          aria-invalid={Boolean(fieldErrors.employeeCount)}
          aria-describedby={fieldErrors.employeeCount ? 'demo-count-error' : undefined}
          className={INPUT}
        />
        {fieldErrors.employeeCount && (
          <p id="demo-count-error" className="text-sm font-semibold text-danger">
            {fieldErrors.employeeCount}
          </p>
        )}
      </div>

      {/* Pułapka na boty - ukryte przed ludźmi i czytnikami ekranu. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="demo-website">Nie wypełniaj tego pola</label>
        <input
          id="demo-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <Button type="submit" disabled={isSubmitting} className="h-12 w-full text-[15px]">
        {isSubmitting ? 'Wysyłanie...' : 'Umów demo'}
      </Button>
      <span className="text-xs text-muted">Bez zobowiązań. Odpisujemy w 1 dzień roboczy.</span>
    </form>
  );
}
