import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Klon szablonu (globalnego albo własnego) do organizacji; opcjonalna nazwa.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const payload = typeof body?.name === 'string' && body.name.trim() ? { name: body.name } : {};
  return proxyAuthenticated('POST', `/phishing/templates/${params.id}/clone`, payload);
}
