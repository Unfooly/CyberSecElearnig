import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Anulowanie kampanii (zmienia stan: wymaga żądania z naszej własnej strony - sprawdza proxyAuthenticated).
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', `/phishing/campaigns/${params.id}/cancel`, {});
}
