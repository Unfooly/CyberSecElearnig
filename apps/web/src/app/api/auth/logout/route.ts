import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearAuthCookies } from '@/lib/auth-cookies';
import { isSameOriginRequest } from '@/lib/bff';

// Wylogowanie: czyści oba httpOnly cookies (JS w przeglądarce ich nie widzi,
// więc musi to zrobić serwer). Tylko POST z własnej strony - GET wylogowywałby
// przez zwykły link/obrazek z obcej strony (logout-CSRF).
export async function POST() {
  if (!isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403 });
  }
  clearAuthCookies(cookies());
  return NextResponse.json({ success: true });
}
