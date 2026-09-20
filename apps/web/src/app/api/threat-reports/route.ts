import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';

// Zgłoszenie podejrzanej wiadomości (każda zalogowana rola). Ciało z jawnej allowlisty pól tekstowych; limity długości,
// sanityzację, dopasowanie do symulacji i limity zgłoszeń per użytkownik egzekwuje apps/api.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const optional = (value: unknown) => value === undefined || typeof value === 'string';
  if (!body || typeof body.sender !== 'string' || typeof body.subject !== 'string' || !optional(body.body) || !optional(body.headers) || !optional(body.comment)) {
    return NextResponse.json({ message: 'Nieprawidłowe dane zgłoszenia.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/threat-reports', {
    sender: body.sender,
    subject: body.subject,
    ...(body.body ? { body: body.body } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.comment ? { comment: body.comment } : {}),
  });
}
