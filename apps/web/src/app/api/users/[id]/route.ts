import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/${encodeURIComponent(params.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy edycji pracownika:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/${encodeURIComponent(params.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy usuwaniu pracownika:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  // 204 No Content od apps/api nie ma body - NextResponse.json(null) na 204
  // wysłałoby "null" jako treść, co jest niepoprawne dla statusu bez treści.
  if (backendResponse.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
