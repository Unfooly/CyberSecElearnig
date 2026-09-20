import { importRoutes } from '@/lib/import-routes';

// Potwierdzenie importu: tworzy konta po sprawdzeniu limitu licencji; zaproszenia idą w kolejce z tempem. Tylko ORG_ADMIN.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return importRoutes.confirm(params.id);
}
