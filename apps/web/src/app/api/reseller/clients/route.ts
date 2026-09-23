import { proxyAuthenticated } from '@/lib/bff';

// Lista klientów zalogowanego partnera (D-070). Zakres wynika WYŁĄCZNIE z tokena po stronie
// apps/api - tu nie ma żadnego parametru, którym dałoby się wskazać cudzą listę.
export async function GET() {
  return proxyAuthenticated('GET', '/reseller/clients');
}
