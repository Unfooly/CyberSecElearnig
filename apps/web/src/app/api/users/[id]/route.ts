import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { pickFields } from '@/lib/pick-fields';
import { isSafeId } from '@/lib/safe-id';

// Edycja i usunięcie pracownika. Obie zmieniają stan: proxyAuthenticated wymaga żądania z naszej własnej strony (CSRF), ścieżka jest stała
// po stronie serwera (identyfikator tylko po isSafeId), ciało PATCH z allowlisty pól. Uprawnienia (ORG_ADMIN), zasady zmiany roli i
// filtr po organizacji egzekwuje apps/api.
const badId = () => NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) return badId();
  const body = pickFields(await request.json().catch(() => null), ['firstName', 'lastName', 'departmentId', 'role']);
  if (!body) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }
  return proxyAuthenticated('PATCH', `/users/${params.id}`, body);
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) return badId();
  // 204 No Content bez ciała obsługuje proxyAuthenticated.
  return proxyAuthenticated('DELETE', `/users/${params.id}`);
}
