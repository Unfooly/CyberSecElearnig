import { NextRequest } from 'next/server';
import { resultsRoutes } from '@/lib/results-routes';

// CSV wyników osobowych: ta sama ochrona co JSON (ORG_ADMIN + flaga, audyt EXPORTED); błąd zawsze jako JSON, nigdy jako plik.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return resultsRoutes.peopleCsv(params.id, request);
}
