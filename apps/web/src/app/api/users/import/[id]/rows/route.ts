import { NextRequest } from 'next/server';
import { importRoutes } from '@/lib/import-routes';

// Wiersze importu z filtrem statusu i stronicowaniem (zapytanie z allowlisty). Tylko ORG_ADMIN (egzekwuje apps/api).
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return importRoutes.rows(params.id, request);
}
