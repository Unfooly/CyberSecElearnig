import { importRoutes } from '@/lib/import-routes';

// Ostatni potwierdzony import organizacji (postęp po ponownym otwarciu kreatora). Tylko ORG_ADMIN (egzekwuje apps/api).
export async function GET() {
  return importRoutes.latest();
}
