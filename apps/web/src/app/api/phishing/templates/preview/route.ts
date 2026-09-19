import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';

// Podgląd sanityzacji treści (nic nie zapisuje). Allowlista pól.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const payload: Record<string, string> = {};
  if (typeof body?.bodyHtml === 'string') payload.bodyHtml = body.bodyHtml;
  if (typeof body?.lessonHtml === 'string') payload.lessonHtml = body.lessonHtml;
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/phishing/templates/preview', payload);
}
