import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Odłączenie organizacji od partnera (operator, D-070) - klient nie może tego zrobić sam,
// więc nie ma odpowiednika tej trasy w panelu klienta.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; organizationId: string } },
) {
  if (!isSafeId(params.id) || !isSafeId(params.organizationId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  return proxyAuthenticated('DELETE', `/resellers/${params.id}/organizations/${params.organizationId}`);
}
