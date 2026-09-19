import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { TEMPLATE_EDITABLE_FIELDS } from '@/lib/phishing-types';
import { isSafeId } from '@/lib/safe-id';

const BAD_ID = () => NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) return BAD_ID();
  return proxyAuthenticated('GET', `/phishing/templates/${params.id}`);
}

// Edycja: ALLOWLISTA pól (bez organizationId, key, senderDomain itd. - domena nadawcy jest zawsze nasza).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) return BAD_ID();
  const body = await request.json().catch(() => null);
  const payload: Record<string, string> = {};
  for (const field of TEMPLATE_EDITABLE_FIELDS) {
    if (typeof body?.[field] === 'string') payload[field] = body[field];
  }
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });
  }
  return proxyAuthenticated('PATCH', `/phishing/templates/${params.id}`, payload);
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSafeId(params.id)) return BAD_ID();
  return proxyAuthenticated('DELETE', `/phishing/templates/${params.id}`);
}
