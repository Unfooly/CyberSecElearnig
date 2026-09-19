'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { isValidNip, PL_POSTAL_CODE_REGEX } from '@cyberszkolo/shared';
import Logo from '@/components/Logo';
import { EMAIL_REGEX } from '@/lib/email';
import { NAME_PATTERN, NAME_PATTERN_MESSAGE } from '@/lib/name-pattern';

type FieldName =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'organizationLegalName'
  | 'organizationName'
  | 'taxId'
  | 'addressLine'
  | 'postalCode'
  | 'city'
  | 'consents';

type Values = Record<Exclude<FieldName, 'consents'>, string>;
type Errors = Partial<Record<FieldName, string>>;

const INITIAL: Values = {
  firstName: '',
  lastName: '',
  email: '',
  organizationLegalName: '',
  organizationName: '',
  taxId: '',
  addressLine: '',
  postalCode: '',
  city: '',
};

const INPUT =
  'h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft';

// Walidacja tylko dla UX - te same reguły egzekwuje apps/api (RegisterDto).
function validate(values: Values, acceptTerms: boolean, acceptPrivacy: boolean): Errors {
  const errors: Errors = {};
  // Limity długości = RegisterDto (apps/api): imię/nazwisko max 100 + NAME_PATTERN,
  // nazwy firmy 2-255, adres 3-255, miejscowość 2-120, e-mail max 254.
  const required: Array<[keyof Values, string, number, number]> = [
    ['firstName', 'Podaj imię.', 1, 100],
    ['lastName', 'Podaj nazwisko.', 1, 100],
    ['organizationLegalName', 'Podaj pełną nazwę firmy.', 2, 255],
    ['organizationName', 'Podaj nazwę wyświetlaną.', 2, 255],
    ['addressLine', 'Podaj ulicę i numer.', 3, 255],
    ['city', 'Podaj miejscowość.', 2, 120],
  ];
  for (const [field, message, min, max] of required) {
    const length = values[field].trim().length;
    if (length === 0) errors[field] = message;
    else if (length < min) errors[field] = `Wpisz co najmniej ${min} znaki.`;
    else if (length > max) errors[field] = `Maksymalnie ${max} znaków.`;
  }
  for (const field of ['firstName', 'lastName'] as const) {
    if (!errors[field] && !NAME_PATTERN.test(values[field].trim())) errors[field] = NAME_PATTERN_MESSAGE;
  }
  const email = values.email.trim();
  if (!email) errors.email = 'Podaj służbowy adres e-mail.';
  else if (!EMAIL_REGEX.test(email) || email.length > 254) errors.email = 'Podaj poprawny adres e-mail.';

  if (!values.taxId.trim()) errors.taxId = 'Podaj NIP.';
  else if (!isValidNip(values.taxId)) errors.taxId = 'Podaj poprawny NIP (10 cyfr).';

  if (!values.postalCode.trim()) errors.postalCode = 'Podaj kod pocztowy.';
  else if (!PL_POSTAL_CODE_REGEX.test(values.postalCode.trim())) errors.postalCode = 'Kod pocztowy w formacie 00-000.';

  if (!acceptTerms || !acceptPrivacy) {
    errors.consents = 'Aby założyć konto, zaakceptuj Regulamin i potwierdź zapoznanie się z Polityką prywatności.';
  }
  return errors;
}

function Field({
  name,
  label,
  values,
  errors,
  onChange,
  type = 'text',
  autoComplete,
  hint,
}: {
  name: keyof Values;
  label: string;
  values: Values;
  errors: Errors;
  onChange: (name: keyof Values, value: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const error = errors[name];
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={values[name]}
        onChange={(event) => onChange(name, event.target.value)}
        className={INPUT}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
      />
      {hint && !error && (
        <p id={`${name}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const [values, setValues] = useState<Values>(INITIAL);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  function handleChange(name: keyof Values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found = validate(values, acceptTerms, acceptPrivacy);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      // Fokus na pierwszym błędnym polu (czytniki ekranu, klawiatura).
      document.getElementById(firstInvalid === 'consents' ? 'acceptTerms' : firstInvalid)?.focus?.();
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])),
          acceptTerms,
          acceptPrivacyPolicy: acceptPrivacy,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // Komunikaty z apps/api są generyczne (nie ujawniają stanu kont); domena
        // publiczna to jedyny przypadek, w którym API mówi o domenie wprost.
        setFormError(data?.message ?? 'Rejestracja nie powiodła się.');
        return;
      }
      setDoneMessage(
        data?.message ??
          'Jeśli podane dane są poprawne, wysłaliśmy wiadomość z linkiem na podany adres e-mail.',
      );
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (doneMessage) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="w-full max-w-md rounded-card border border-border bg-surface p-8 shadow-card">
          <div className="mb-6">
            <Logo variant="dark" height={28} />
          </div>
          <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Sprawdź skrzynkę e-mail</h1>
          <p role="status" className="mb-4 text-muted">
            {doneMessage}
          </p>
          <p className="mb-6 text-sm text-muted">
            Po ustawieniu hasła zalogujesz się i dokończysz weryfikację domeny firmowej. Link jest ważny 24 godziny.
          </p>
          <Link href="/login" className="font-semibold text-accent-ink hover:underline">
            Przejdź do logowania
          </Link>
        </div>
      </main>
    );
  }

  const fieldProps = { values, errors, onChange: handleChange };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-xl rounded-card border border-border bg-surface p-8 shadow-card">
        <div className="mb-6">
          <Logo variant="dark" height={28} />
        </div>
        <h1 className="mb-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Załóż konto firmy</h1>
        <p className="mb-6 text-muted">
          Hasło ustawisz po potwierdzeniu adresu e-mail - wyślemy na niego link.
        </p>
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-extrabold uppercase tracking-wide text-muted">Administrator</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="firstName" label="Imię" autoComplete="given-name" {...fieldProps} />
              <Field name="lastName" label="Nazwisko" autoComplete="family-name" {...fieldProps} />
            </div>
            <Field
              name="email"
              label="Służbowy adres e-mail"
              type="email"
              autoComplete="email"
              hint="Adres w domenie firmowej - jej własność potwierdzisz w kolejnym kroku (adresy z Gmaila, WP itp. nie są akceptowane)."
              {...fieldProps}
            />
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-extrabold uppercase tracking-wide text-muted">Firma</legend>
            <Field name="organizationLegalName" label="Pełna nazwa firmy" autoComplete="organization" {...fieldProps} />
            <Field
              name="organizationName"
              label="Nazwa wyświetlana"
              hint="Tak zobaczą ją pracownicy, np. w wiadomościach."
              {...fieldProps}
            />
            <Field name="taxId" label="NIP" {...fieldProps} />
            <Field name="addressLine" label="Ulica i numer" autoComplete="street-address" {...fieldProps} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="postalCode" label="Kod pocztowy" autoComplete="postal-code" {...fieldProps} />
              <Field name="city" label="Miejscowość" autoComplete="address-level2" {...fieldProps} />
            </div>
            <div>
              <label htmlFor="country" className="mb-1 block text-sm font-semibold text-ink">
                Kraj
              </label>
              <input id="country" value="Polska" readOnly aria-readonly="true" className={`${INPUT} bg-paper text-muted`} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="sr-only">Zgody</legend>
            <label className="flex items-start gap-3 text-sm">
              <input
                id="acceptTerms"
                type="checkbox"
                checked={acceptTerms}
                aria-invalid={Boolean(errors.consents) && !acceptTerms}
                aria-describedby={errors.consents ? 'consents-error' : undefined}
                onChange={(event) => setAcceptTerms(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                Akceptuję{' '}
                <Link href="/regulamin" target="_blank" className="font-semibold text-accent-ink underline">
                  Regulamin
                </Link>
                .
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={acceptPrivacy}
                aria-invalid={Boolean(errors.consents) && !acceptPrivacy}
                aria-describedby={errors.consents ? 'consents-error' : undefined}
                onChange={(event) => setAcceptPrivacy(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                Zapoznałem(-am) się z{' '}
                <Link href="/polityka-prywatnosci" target="_blank" className="font-semibold text-accent-ink underline">
                  Polityką prywatności
                </Link>
                .
              </span>
            </label>
            {errors.consents && (
              <p id="consents-error" role="alert" className="text-sm font-semibold text-danger">
                {errors.consents}
              </p>
            )}
          </fieldset>

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
            {isSubmitting ? 'Zakładanie konta...' : 'Załóż konto firmy'}
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
