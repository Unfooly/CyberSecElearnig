import { cookies } from 'next/headers';
import { clearAuthCookies } from '@/lib/auth-cookies';
import { proxyAuthenticated } from '@/lib/bff';

// "Wyloguj wszędzie": API unieważnia wszystkie sesje użytkownika (access tokeny natychmiast, refresh
// tokeny wszystkich urządzeń). Po sukcesie czyścimy też cookies tej przeglądarki. Ochrona Origin
// (CSRF) jest w proxyAuthenticated.
export async function POST() {
  const response = await proxyAuthenticated('POST', '/auth/logout-all');
  if (response.ok) {
    clearAuthCookies(cookies());
  }
  return response;
}
