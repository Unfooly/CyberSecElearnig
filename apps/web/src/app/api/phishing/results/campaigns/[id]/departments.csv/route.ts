import { resultsRoutes } from '@/lib/results-routes';

// CSV agregatów per dział (zakres i progi liczebności ustala apps/api; bez danych osobowych).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return resultsRoutes.departmentsCsv(params.id);
}
