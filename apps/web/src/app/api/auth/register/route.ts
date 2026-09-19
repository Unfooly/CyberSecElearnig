import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Pola tekstowe przekazywane do apps/api - ALLOWLISTA: inne klucze z żądania
// (np. status, role, password, country) nigdy nie docierają do backendu.
// Kraj celowo nie jest przekazywany (MVP: tylko PL, backend ustawia domyślnie).
const TEXT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'organizationLegalName',
  'organizationName',
  'taxId',
  'addressLine',
  'postalCode',
  'city',
] as const;

// Proxy server-side do apps/api. /auth/register NIE zwraca tokenów ani hasła
// (hasło ustawia się dopiero linkiem z maila) - przekazujemy tylko komunikat.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const payload: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    payload[field] = typeof body?.[field] === 'string' ? body[field] : '';
  }
  payload.acceptTerms = body?.acceptTerms === true;
  payload.acceptPrivacyPolicy = body?.acceptPrivacyPolicy === true;

  if (TEXT_FIELDS.some((field) => payload[field] === '')) {
    return NextResponse.json({ message: 'Uzupełnij wszystkie pola.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas rejestracji:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // apps/api zwraca albo pojedynczy string, albo tablicę komunikatów
    // walidacji (class-validator) - normalizujemy do jednego stringa. Komunikaty
    // nie ujawniają stanu kont (anty-enumeracja po stronie API).
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    return NextResponse.json(
      { message: message ?? 'Rejestracja nie powiodła się.', code: data?.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json({
    message:
      typeof data?.message === 'string'
        ? data.message
        : 'Jeśli podane dane są poprawne, wysłaliśmy wiadomość z linkiem na podany adres e-mail.',
  });
}
