'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ASSIGNABLE_ROLES, ROLE_LABELS, type AssignableRole, type DepartmentOption, type UserListItem } from '@/lib/users-types';

export default function EditUserModal({
  user,
  departments,
  onClose,
  onSaved,
}: {
  user: UserListItem;
  departments: DepartmentOption[];
  onClose: () => void;
  onSaved: (user: UserListItem) => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [departmentId, setDepartmentId] = useState(user.department?.id ?? '');
  const [role, setRole] = useState<AssignableRole>(user.role);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setFormError('Imię i nazwisko nie mogą być puste.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          // null (jawnie) = usuń przypisanie do działu, zgodnie z
          // UpdateUserDto na backendzie.
          departmentId: departmentId || null,
          role,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(data?.message ?? 'Nie udało się zapisać zmian.');
        return;
      }

      onSaved(data as UserListItem);
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
      aria-labelledby="edit-user-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-card border border-border bg-surface p-6 shadow-card sm:rounded-card">
        <h2 id="edit-user-title" className="mb-4 text-lg font-bold tracking-[-0.01em]">
          Edytuj pracownika
        </h2>
        <p className="mb-4 text-sm text-muted">{user.email}</p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="edit-firstName" className="mb-1 block text-sm font-semibold text-ink">
              Imię
            </label>
            <input
              id="edit-firstName"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
          </div>

          <div>
            <label htmlFor="edit-lastName" className="mb-1 block text-sm font-semibold text-ink">
              Nazwisko
            </label>
            <input
              id="edit-lastName"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
          </div>

          <div>
            <label htmlFor="edit-department" className="mb-1 block text-sm font-semibold text-ink">
              Dział
            </label>
            <select
              id="edit-department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
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
            <label htmlFor="edit-role" className="mb-1 block text-sm font-semibold text-ink">
              Rola
            </label>
            <select
              id="edit-role"
              value={role}
              onChange={(event) => setRole(event.target.value as AssignableRole)}
              className="h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            >
              {ASSIGNABLE_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          {formError && (
            <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}

          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-btn px-4 text-sm font-bold text-accent-ink hover:bg-accent-soft"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-10 rounded-btn bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {isSubmitting ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
