import { proxyAuthenticated } from '@/lib/bff';

// Organizacje klienckie z informacją, kto je dziś obsługuje (panel operatora, D-070).
// Trasa stoi PRZED [id] w drzewie plików Next tylko dzięki temu, że jest osobnym segmentem
// statycznym - Next zawsze przedkłada segment statyczny nad dynamiczny, więc kolizji nie ma.
export async function GET() {
  return proxyAuthenticated('GET', '/resellers/assignable-organizations');
}
