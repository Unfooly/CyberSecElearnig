import { NextRequest } from 'next/server';
import { threatReportRoutes } from '@/lib/threat-report-routes';

// Szczegóły zgłoszenia (treść, zgłaszający, dziennik zdarzeń) - tylko ORG_ADMIN (egzekwuje apps/api).
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return threatReportRoutes.detail(params.id);
}
