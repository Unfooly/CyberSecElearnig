import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Szczegóły kampanii (statystyki zbiorcze, bez danych per osoba).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  return proxyAuthenticated('GET', `/phishing/campaigns/${params.id}`);
}
