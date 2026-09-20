import { NextRequest } from 'next/server';
import { threatReportRoutes } from '@/lib/threat-report-routes';

// Skrzynka zgłoszeń (tylko ORG_ADMIN - egzekwuje apps/api).
export async function GET(request: NextRequest) {
  return threatReportRoutes.list(request);
}
