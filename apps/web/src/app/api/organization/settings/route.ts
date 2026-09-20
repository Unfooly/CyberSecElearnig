import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';

// Ustawienia zmieniane z UI: selfJoinEnabled i timezone (strefa IANA, poprawność sprawdza API). Allowlista pól po stronie
// BFF - inne klucze z żądania (np. status, name) nigdy nie docierają do API. Wymagane co najmniej jedno z dwóch pól.
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const hasSelfJoin = typeof body?.selfJoinEnabled === 'boolean';
  const hasTimezone = typeof body?.timezone === 'string' && body.timezone.length <= 64;
  if (!hasSelfJoin && !hasTimezone) {
    return NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });
  }
  return proxyAuthenticated('PATCH', '/organization/settings', {
    ...(hasSelfJoin ? { selfJoinEnabled: body.selfJoinEnabled } : {}),
    ...(hasTimezone ? { timezone: body.timezone } : {}),
  });
}
