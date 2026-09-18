import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';

// Publiczny proxy formularza "Umów demo" -> POST /demo-requests w apps/api.
// Bez cookie/JWT (odwiedzający jest anonimowy); walidację i limit żądań
// robi backend.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: 'Nieprawidłowe dane formularza.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${API_URL}/demo-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Limit żądań w apps/api liczy IP klienta - przekazujemy je dalej.
        ...(request.headers.get('x-forwarded-for')
          ? { 'X-Forwarded-For': request.headers.get('x-forwarded-for') as string }
          : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy wysyłce formularza demo:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
