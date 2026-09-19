import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Proxy multipart - czytamy FormData z żądania przeglądarki i budujemy NOWY
// FormData do apps/api, zamiast ręcznie przekazywać surowe body/nagłówki:
// fetch() sam ustawi poprawny multipart Content-Type z boundary dla nowego
// FormData, więc nie trzeba go odtwarzać ręcznie.
export async function POST(request: NextRequest) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  const incoming = await request.formData().catch(() => null);
  const file = incoming?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ message: 'Brak pliku CSV w żądaniu.' }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append('file', file, file.name);

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/import-csv`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: outgoing,
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy imporcie CSV:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
