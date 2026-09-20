import { NextRequest } from 'next/server';
import { threatReportRoutes } from '@/lib/threat-report-routes';

// Zmiana statusu zgłoszenia (wpis w dzienniku zdarzeń po stronie API) - tylko ORG_ADMIN.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return threatReportRoutes.status(params.id, request);
}
