import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';

// Jedyne ustawienie zmieniane z UI: selfJoinEnabled. Allowlista pól po stronie
// BFF - inne klucze z żądania (np. status, name) nigdy nie docierają do API.
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (typeof body?.selfJoinEnabled !== 'boolean') {
    return NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });
  }
  return proxyAuthenticated('PATCH', '/organization/settings', { selfJoinEnabled: body.selfJoinEnabled });
}
