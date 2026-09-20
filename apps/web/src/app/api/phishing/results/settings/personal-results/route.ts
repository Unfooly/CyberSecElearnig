import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';

// Włączenie/wyłączenie wyników osobowych. Ciało z jawnej allowlisty (enabled, justification); wymóg uzasadnienia,
// uprawnienia i audyt egzekwuje apps/api.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean' || (body.justification !== undefined && typeof body.justification !== 'string')) {
    return NextResponse.json({ message: 'Nieprawidłowe dane.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/phishing/results/settings/personal-results', {
    enabled: body.enabled,
    ...(typeof body.justification === 'string' ? { justification: body.justification } : {}),
  });
}
