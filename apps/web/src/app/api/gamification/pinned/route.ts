import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';

// Przypięte osiągnięcia WŁASNEGO profilu (D-112): cała lista kodów w kolejności na profilu. Do API idzie wyłącznie `codes`
// (tablica krótkich kodów) - czy są zdobyte, bez duplikatów i maks. 3, sprawdza API; użytkownik i organizacja tylko z tokena.
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const codes: unknown = body?.codes;
  // Luźniejszy limit niż 3 celowo: przy 4+ kodach API odpowiada komunikatem „Możesz przypiąć maksymalnie 3 odznaki.” (UI go
  // pokazuje); BFF odcina tylko wyraźnie złe żądania.
  if (!Array.isArray(codes) || codes.length > 10 || !codes.every((code) => typeof code === 'string' && code.length <= 64)) {
    return NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });
  }
  return proxyAuthenticated('PUT', '/gamification/pinned', { codes });
}
