import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { formatDateLong } from '@/lib/datetime';
import type { ResellerClient } from '@/lib/reseller-types';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardHeader } from '@/components/ui/Card';
import { Table, Td, Th, Tr } from '@/components/ui/Table';

// Panel partnera (RESELLER_ADMIN - middleware.ts i RolesGuard w apps/api): lista obsługiwanych
// organizacji. Krok 1 (D-069) celowo NIE daje dostępu do danych klienta - tylko metadane
// organizacji. Wejście w organizację klienta to osobne zadanie (token zakresowany + audyt).
export default async function ResellerPanelPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);

  const clientsResult = await fetchJson<ResellerClient[]>(`${API_URL}/reseller/clients`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!clientsResult.ok && clientsResult.status === 401) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={payload?.email ?? null} role={payload?.role} />
      <main className="mx-auto max-w-[1100px] px-6 pb-12 pt-9">
        <PageHeader title="Moi klienci" subtitle="Organizacje, którymi się opiekujesz." />
        <Card>
          <CardHeader title="Obsługiwane organizacje" />
          {clientsResult.ok ? (
            <Table>
              <thead>
                <tr>
                  <Th>Organizacja</Th>
                  <Th>Status</Th>
                  <Th>Plan</Th>
                  <Th>Licencje</Th>
                  <Th>Od</Th>
                </tr>
              </thead>
              <tbody>
                {clientsResult.data.length === 0 ? (
                  <Tr>
                    <Td colSpan={5} className="text-muted">
                      Nie masz jeszcze przypisanych organizacji. Przypisuje je operator platformy.
                    </Td>
                  </Tr>
                ) : (
                  clientsResult.data.map((client) => (
                    <Tr key={client.id}>
                      <Td className="font-semibold">{client.name}</Td>
                      <Td className="text-muted">
                        {client.status === 'ACTIVE' ? 'Aktywna' : 'Czeka na weryfikację domeny'}
                      </Td>
                      <Td className="text-muted">{client.plan}</Td>
                      <Td className="text-muted">{client.seatsLimit}</Td>
                      <Td className="text-muted">{formatDateLong(client.assignedAt)}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          ) : (
            <p role="alert" className="p-5 text-sm font-semibold text-danger">
              Nie udało się załadować listy klientów. Odśwież stronę.
            </p>
          )}
        </Card>
      </main>
    </div>
  );
}
