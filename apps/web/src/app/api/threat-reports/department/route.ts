import { NextRequest } from 'next/server';
import { threatReportRoutes } from '@/lib/threat-report-routes';

// Ograniczona lista zgłoszeń własnego działu (tylko DEPARTMENT_MANAGER - egzekwuje apps/api): bez zgłaszającego i treści.
export async function GET(request: NextRequest) {
  return threatReportRoutes.department(request);
}
