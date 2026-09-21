import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Ponowne zaproszenie (wysyła e-mail: zmienia stan i ma skutek poza aplikacją): proxyAuthenticated wymaga żądania z naszej własnej strony,
// ścieżka stała (identyfikator tylko po isSafeId), bez ciała.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', `/users/${params.id}/resend-invite`);
}
