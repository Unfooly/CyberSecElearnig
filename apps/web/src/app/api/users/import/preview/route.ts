import { NextRequest } from 'next/server';
import { previewProxy } from '@/lib/import-routes';

// Podgląd importu pracowników (multipart, pole `file`): walidacja per wiersz i stan miejsc; niczego nie tworzy. Tylko ORG_ADMIN.
export async function POST(request: NextRequest) {
  return previewProxy(request);
}
