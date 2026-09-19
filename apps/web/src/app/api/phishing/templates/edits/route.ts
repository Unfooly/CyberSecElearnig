import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Historia zmian szablonów (audyt); opcjonalny filtr ?templateId= (walidowany, nie przekazujemy surowego query).
export async function GET(request: NextRequest) {
  const templateId = request.nextUrl.searchParams.get('templateId');
  if (templateId !== null && !isSafeId(templateId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }
  const query = templateId ? `?templateId=${encodeURIComponent(templateId)}` : '';
  return proxyAuthenticated('GET', `/phishing/templates/edits${query}`);
}
