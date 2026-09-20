import { NextRequest } from 'next/server';
import { resultsRoutes } from '@/lib/results-routes';

// Wyniki OSOBOWE kampanii: ORG_ADMIN + włączona flaga (403 bez niej) - egzekwuje apps/api; każdy wgląd jest audytowany.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return resultsRoutes.people(params.id, request);
}
