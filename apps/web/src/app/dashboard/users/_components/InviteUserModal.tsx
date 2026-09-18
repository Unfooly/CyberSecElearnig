'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Role } from '@cyberszkolo/shared';
import { ASSIGNABLE_ROLES, ROLE_LABELS, type AssignableRole, type DepartmentOption, type InviteUserResult } from '@/lib/users-types';
import { EMAIL_REGEX } from '@/lib/email';
import { NAME_PATTERN, NAME_PATTERN_MESSAGE } from '@/lib/name-pattern';


interface FieldErrors {
  email?: string;
  firstName?: string;
  lastName?: string;
}

export default function InviteUserModal({
  departments,
  onClose,
  onCreated,
}: {
  departments: DepartmentOption[];
  onClose: () => void;
  onCreated: (user: InviteUserResult) => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState<AssignableRole>(Role.EMPLOYEE);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!email.trim()) {
      errors.email = 'Podaj adres e-mail.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Podaj poprawny adres e-mail.';
    }
    if (!firstName.trim()) {
      errors.firstName = 'Podaj imię.';
    } else if (!NAME_PATTERN.test(firstName.trim())) {
      errors.firstName = NAME_PATTERN_MESSAGE;
    }
    if (!lastName.trim()) {
      errors.lastName = 'Podaj nazwisko.';
    } else if (!NAME_PATTERN.test(lastName.trim())) {
      errors.lastName = NAME_PATTERN_MESSAGE;
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
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          departmentId: departmentId || undefined,
          role,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(data?.message ?? 'Nie udało się zaprosić pracownika.');
        return;
      }

      onCreated(data as InviteUserResult);
    } catch {
      setFormError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-user-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
        <h2 id="invite-user-title" className="mb-4 text-lg font-semibold text-slate-900">
          Zaproś pracownika
        </h2>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="invite-firstName" className="mb-1 block text-sm font-medium text-slate-700">
              Imię
            </label>
            <input
              id="invite-firstName"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.firstName)}
            />
            {fieldErrors.firstName && <p className="mt-1 text-sm text-red-600">{fieldErrors.firstName}</p>}
          </div>

          <div>
            <label htmlFor="invite-lastName" className="mb-1 block text-sm font-medium text-slate-700">
              Nazwisko
            </label>
            <input
              id="invite-lastName"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.lastName)}
            />
            {fieldErrors.lastName && <p className="mt-1 text-sm text-red-600">{fieldErrors.lastName}</p>}
          </div>

          <div>
            <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email && <p className="mt-1 text-sm text-red-600">{fieldErrors.email}</p>}
          </div>

          <div>
            <label htmlFor="invite-department" className="mb-1 block text-sm font-medium text-slate-700">
              Dział
            </label>
            <select
              id="invite-department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">Bez działu</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="invite-role" className="mb-1 block text-sm font-medium text-slate-700">
              Rola
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as AssignableRole)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              {ASSIGNABLE_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          {formError && (
            <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Zapraszanie...' : 'Zaproś'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
