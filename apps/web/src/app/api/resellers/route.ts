import { NextRequest, NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { pickFields } from '@/lib/pick-fields';

// Panel operatora (D-070): lista partnerów i zakładanie nowego. Rolę (SUPER_ADMIN) sprawdza apps/api.
export async function GET() {
  return proxyAuthenticated('GET', '/resellers');
}

export async function POST(request: NextRequest) {
  const body = pickFields(await request.json().catch(() => null), [
    'name',
    'adminEmail',
    'adminFirstName',
    'adminLastName',
  ]);
  if (!body) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/resellers', body);
}
