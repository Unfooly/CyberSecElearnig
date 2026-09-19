import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { buildAudience } from '@/lib/campaign-body';
import { isSafeId } from '@/lib/safe-id';

// Lista kampanii organizacji. Tylko ORG_ADMIN - egzekwuje apps/api.
export async function GET() {
  return proxyAuthenticated('GET', '/phishing/campaigns');
}

// Utworzenie i uruchomienie kampanii (kreator). Ciało z jawnej allowlisty; walidację biznesową robi apps/api.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const audience = buildAudience(body?.audience);
  if (
    !body ||
    typeof body.name !== 'string' ||
    !isSafeId(body.templateId) ||
    !audience ||
    typeof body.windowStart !== 'string' ||
    typeof body.windowEnd !== 'string' ||
    body.acknowledged !== true
  ) {
    return NextResponse.json({ message: 'Nieprawidłowe dane kampanii.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/phishing/campaigns', {
    name: body.name,
    templateId: body.templateId,
    audience,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    acknowledged: true,
  });
}
