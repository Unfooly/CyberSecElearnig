import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';
import { pickFields } from '@/lib/pick-fields';

// Przypisanie organizacji klienckiej do partnera (operator, D-070). Ścieżka składana wyłącznie
// z identyfikatora sprawdzonego przez isSafeId; ciało z allowlisty. Rolę sprawdza apps/api.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  const body = pickFields(await request.json().catch(() => null), ['organizationId']);
  if (!body) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', `/resellers/${params.id}/organizations`, body);
}
