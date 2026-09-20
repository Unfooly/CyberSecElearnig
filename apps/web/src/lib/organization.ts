import { redirect } from 'next/navigation';
import { API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { ONBOARDING_PATH } from '@/lib/home-path';

export type OrganizationStatus = 'PENDING_DOMAIN_VERIFICATION' | 'ACTIVE';

export interface OrganizationOverview {
  id: string;
  name: string;
  status: OrganizationStatus;
  selfJoinEnabled: boolean;
  // Strefa czasowa organizacji (IANA); opcjonalna w typie dla zgodności ze starszymi odpowiedziami/testami.
  timezone?: string;
  billing: {
    legalName: string;
    taxId: string;
    addressLine: string;
    postalCode: string;
    city: string;
    country: string;
  } | null;
  domain: {
    name: string;
    verified: boolean;
    verifiedAt: string | null;
    lastCheckedAt: string | null;
    txtRecord: { type: 'TXT'; host: string; value: string };
  } | null;
}

export const ORGANIZATION_PENDING_CODE = 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION';

// Pobiera stan organizacji server-side (Server Components / Route Handlery).
export function fetchOrganization(accessToken: string) {
  return fetchJson<OrganizationOverview>(`${API_URL}/organization/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    // Wisząca odpowiedź API nie może blokować logowania ani renderu strony.
    signal: AbortSignal.timeout(5000),
  });
}

/**
 * Wołane, gdy API odpowiedziało 403 na stronie biznesowej: jeśli powodem jest
 * organizacja PENDING (guard API), kieruje na ekran weryfikacji domeny.
 * Ochrona danych jest w API (globalny guard) - to wyłącznie UX; brak
 * przekierowania oznacza inny powód 403 (np. rola) i wywołujący decyduje dalej.
 */
export async function redirectIfPending(accessToken: string): Promise<void> {
  const result = await fetchOrganization(accessToken);
  if (result.ok && result.data.status === 'PENDING_DOMAIN_VERIFICATION') {
    redirect(ONBOARDING_PATH);
  }
}
