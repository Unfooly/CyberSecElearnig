import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Proxy server-side do apps/api - reset-password NIE wydaje nowych tokenów
// (świadoma decyzja, patrz auth.service.ts / README), więc tu też nie ma
// cookies do ustawienia - user loguje się od nowa po resecie.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!token || !newPassword) {
    return NextResponse.json({ message: 'Brak wymaganych danych.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas reset-password:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // `code` rozróżnia TOKEN_ALREADY_USED od TOKEN_INVALID_OR_EXPIRED -
    // apps/api już dobrał odpowiedni `message` do przypadku, front go tylko
    // przekazuje dalej, nie interpretuje treści (jak w login/route.ts).
    return NextResponse.json(
      { message: data?.message ?? 'Nie udało się zresetować hasła.', code: data?.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json({ message: data?.message ?? 'Hasło zostało zmienione.' });
}
