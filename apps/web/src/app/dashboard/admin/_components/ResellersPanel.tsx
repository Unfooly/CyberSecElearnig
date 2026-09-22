'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Card, { CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Fields';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import type { AssignableOrganization, Reseller } from '@/lib/reseller-types';

/**
 * Panel operatora (D-069): zakładanie partnerów i przypisywanie im organizacji klienckich.
 * Wszystkie operacje idą przez trasy BFF (`/api/resellers/*`), a rolę SUPER_ADMIN sprawdza
 * apps/api - tu jest tylko interfejs. Klient nie ma odpowiednika tych akcji: przypisanie
 * i odłączenie resellera to wyłącznie decyzja operatora.
 */
export default function ResellersPanel({
  initialResellers,
  initialOrganizations,
}: {
  initialResellers: Reseller[];
  initialOrganizations: AssignableOrganization[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [selectedReseller, setSelectedReseller] = useState<string>(initialResellers[0]?.id ?? '');
  const [selectedOrganization, setSelectedOrganization] = useState<string>('');

  const unassigned = initialOrganizations.filter((organization) => organization.resellerId === null);

  async function send(path: string, init: RequestInit, failureMessage: string): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.message ?? failureMessage);
        return false;
      }
      // Dane listy przychodzą z serwera (Server Component), więc po zmianie odświeżamy stronę.
      router.refresh();
      return true;
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await send(
      '/api/resellers',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') ?? ''),
          adminEmail: String(data.get('adminEmail') ?? ''),
          adminFirstName: String(data.get('adminFirstName') ?? ''),
          adminLastName: String(data.get('adminLastName') ?? ''),
        }),
      },
      'Nie udało się założyć partnera.',
    );
    if (created) {
      form.reset();
    }
  }

  async function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReseller || !selectedOrganization) {
      return;
    }
    const assigned = await send(
      `/api/resellers/${encodeURIComponent(selectedReseller)}/organizations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: selectedOrganization }),
      },
      'Nie udało się przypisać organizacji.',
    );
    if (assigned) {
      setSelectedOrganization('');
    }
  }

  async function handleUnassign(resellerId: string, organizationId: string) {
    await send(
      `/api/resellers/${encodeURIComponent(resellerId)}/organizations/${encodeURIComponent(organizationId)}`,
      { method: 'DELETE' },
      'Nie udało się odłączyć organizacji.',
    );
  }

  const inputClasses =
    'h-10 w-full rounded-btn border border-border bg-surface px-3 text-sm font-medium placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft';

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <Card>
        <CardHeader title="Partnerzy" />
        <Table>
          <thead>
            <tr>
              <Th>Nazwa</Th>
              <Th>Klienci</Th>
            </tr>
          </thead>
          <tbody>
            {initialResellers.length === 0 ? (
              <Tr>
                <Td colSpan={2} className="text-muted">
                  Nie ma jeszcze żadnego partnera.
                </Td>
              </Tr>
            ) : (
              initialResellers.map((reseller) => (
                <Tr key={reseller.id}>
                  <Td className="font-semibold">{reseller.name}</Td>
                  <Td>{reseller.clientCount}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Nowy partner" />
        <form onSubmit={handleCreate} className="grid gap-3 p-5 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Nazwa firmy
            <input name="name" required maxLength={200} className={`mt-1 ${inputClasses}`} />
          </label>
          <label className="text-sm font-semibold">
            E-mail administratora
            <input name="adminEmail" type="email" required maxLength={254} className={`mt-1 ${inputClasses}`} />
          </label>
          <label className="text-sm font-semibold">
            Imię
            <input name="adminFirstName" required maxLength={100} className={`mt-1 ${inputClasses}`} />
          </label>
          <label className="text-sm font-semibold">
            Nazwisko
            <input name="adminLastName" required maxLength={100} className={`mt-1 ${inputClasses}`} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={isBusy}>
              {isBusy ? 'Zapisywanie...' : 'Załóż partnera'}
            </Button>
            <p className="mt-2 text-sm text-muted">
              Administrator dostanie e-mail z linkiem do ustawienia hasła - tak samo jak zapraszany pracownik.
            </p>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Organizacje klienckie" />
        <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-3 border-b border-border p-5">
          <label className="text-sm font-semibold">
            Partner
            <SelectField
              className="mt-1 w-56"
              value={selectedReseller}
              onChange={(event) => setSelectedReseller(event.target.value)}
              aria-label="Partner"
            >
              {initialResellers.map((reseller) => (
                <option key={reseller.id} value={reseller.id}>
                  {reseller.name}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="text-sm font-semibold">
            Organizacja bez opiekuna
            <SelectField
              className="mt-1 w-64"
              value={selectedOrganization}
              onChange={(event) => setSelectedOrganization(event.target.value)}
              aria-label="Organizacja bez opiekuna"
            >
              <option value="">Wybierz organizację</option>
              {unassigned.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </SelectField>
          </label>
          <Button type="submit" disabled={isBusy || !selectedReseller || !selectedOrganization}>
            Przypisz
          </Button>
        </form>

        <Table>
          <thead>
            <tr>
              <Th>Organizacja</Th>
              <Th>Status</Th>
              <Th>Opiekun</Th>
              <Th>Akcja</Th>
            </tr>
          </thead>
          <tbody>
            {initialOrganizations.length === 0 ? (
              <Tr>
                <Td colSpan={4} className="text-muted">
                  Nie ma jeszcze żadnej organizacji klienckiej.
                </Td>
              </Tr>
            ) : (
              initialOrganizations.map((organization) => (
                <Tr key={organization.id}>
                  <Td className="font-semibold">{organization.name}</Td>
                  <Td className="text-muted">
                    {organization.status === 'ACTIVE' ? 'Aktywna' : 'Czeka na weryfikację domeny'}
                  </Td>
                  <Td>{organization.resellerName ?? <span className="text-muted">bez opiekuna</span>}</Td>
                  <Td>
                    {organization.resellerId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleUnassign(organization.resellerId as string, organization.id)}
                      >
                        Odłącz
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
