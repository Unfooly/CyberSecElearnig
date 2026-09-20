import { importRoutes } from '@/lib/import-routes';

// Podsumowanie importu (ze świeżym stanem miejsc i postępem) oraz anulowanie PODGLĄDU. Tylko ORG_ADMIN (egzekwuje apps/api).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return importRoutes.get(params.id);
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return importRoutes.cancel(params.id);
}
