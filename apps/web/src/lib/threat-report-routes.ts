import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';
import { REPORT_STATUSES, type ReportStatus } from '@/lib/threat-report-types';

const badId = () => NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
const badBody = () => NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });

/** Zapytanie listy tylko z allowlisty (status z enumu, page/pageSize jako cyfry); reszta jest pomijana. */
export function inboxQuery(request: NextRequest): string {
  const params = request.nextUrl.searchParams;
  const parts: string[] = [];
  const status = params.get('status');
  if (status && (REPORT_STATUSES as readonly string[]).includes(status)) {
    parts.push(`status=${status as ReportStatus}`);
  }
  for (const name of ['page', 'pageSize'] as const) {
    const value = params.get(name);
    if (value && /^\d{1,5}$/.test(value)) {
      parts.push(`${name}=${value}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// Wszystkie ścieżki API są STAŁE; identyfikator zgłoszenia przechodzi przez isSafeId, ciała z jawnej allowlisty. Uprawnienia
// (ORG_ADMIN, DEPARTMENT_MANAGER i jego ograniczony zakres) egzekwuje apps/api - BFF niczego nie filtruje ani nie cache'uje.
export const threatReportRoutes = {
  list: (request: NextRequest) => proxyAuthenticated('GET', `/threat-reports/inbox${inboxQuery(request)}`),
  department: (request: NextRequest) => proxyAuthenticated('GET', `/threat-reports/department${inboxQuery(request)}`),
  detail: (id: string) => (isSafeId(id) ? proxyAuthenticated('GET', `/threat-reports/inbox/${id}`) : badId()),
  status: async (id: string, request: NextRequest) => {
    if (!isSafeId(id)) return badId();
    const body = await request.json().catch(() => null);
    if (!body || typeof body.status !== 'string' || !(REPORT_STATUSES as readonly string[]).includes(body.status)) return badBody();
    return proxyAuthenticated('POST', `/threat-reports/inbox/${id}/status`, { status: body.status });
  },
  note: async (id: string, request: NextRequest) => {
    if (!isSafeId(id)) return badId();
    const body = await request.json().catch(() => null);
    if (!body || typeof body.note !== 'string') return badBody();
    return proxyAuthenticated('POST', `/threat-reports/inbox/${id}/notes`, { note: body.note });
  },
};
