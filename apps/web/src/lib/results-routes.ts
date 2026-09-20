import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated, proxyAuthenticatedFile } from '@/lib/bff';
import { PEOPLE_FILTERS, type PeopleFilter } from '@/lib/phishing-types';
import { isSafeId } from '@/lib/safe-id';

const badId = () => NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });

/** Filtr z zapytania tylko z allowlisty (inaczej pomijany => domyślny po stronie API). */
export function peopleFilterQuery(request: NextRequest): string {
  const filter = request.nextUrl.searchParams.get('filter');
  return filter && (PEOPLE_FILTERS as readonly string[]).includes(filter) ? `?filter=${filter as PeopleFilter}` : '';
}

// Wszystkie ścieżki API są STAŁE; identyfikator kampanii przechodzi przez isSafeId. Uprawnienia (ORG_ADMIN, flaga wyników
// osobowych, zakres DEPARTMENT_MANAGER) egzekwuje apps/api - BFF niczego nie filtruje ani nie cache'uje.
export const resultsRoutes = {
  departmentsCsv: (id: string) => (isSafeId(id) ? proxyAuthenticatedFile(`/phishing/results/campaigns/${id}/departments.csv`) : badId()),
  people: (id: string, request: NextRequest) => (isSafeId(id) ? proxyAuthenticated('GET', `/phishing/results/campaigns/${id}/people${peopleFilterQuery(request)}`) : badId()),
  peopleCsv: (id: string, request: NextRequest) => (isSafeId(id) ? proxyAuthenticatedFile(`/phishing/results/campaigns/${id}/people.csv${peopleFilterQuery(request)}`) : badId()),
};
