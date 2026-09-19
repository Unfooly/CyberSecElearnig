import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { buildAudience } from '@/lib/campaign-body';

// Liczba odbiorców dla wybranego grona (krok kreatora); nic nie zapisuje.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const audience = buildAudience(body?.audience);
  if (!audience) {
    return NextResponse.json({ message: 'Nieprawidłowe grono odbiorców.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/phishing/campaigns/audience', { audience });
}
