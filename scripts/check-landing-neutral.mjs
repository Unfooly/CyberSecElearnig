// Sprawdza na BUILDZIE PRODUKCYJNYM, że strona lądowania symulacji phishingowej (/t/*) nie zdradza marki serwisu (B-141, D-127):
// ani w HTML, ani w nagłówkach odpowiedzi. Testy jednostkowe (apps/web/src/lib/site-metadata.test.ts, middleware.test.ts) sprawdzają
// obiekty metadanych i politykę CSP - ten skrypt sprawdza to, co naprawdę wychodzi z serwera (scalanie metadanych robi Next, więc
// podbicie jego wersji mogłoby po cichu przywrócić manifest albo ikony). To odpowiednik `curl /t/<token>` bez cookies.
//
// Użycie z katalogu repo, po `npm run build --workspace=apps/web` (skrypt sam nie buduje, jak check-no-secrets-in-bundle.mjs):
//   node scripts/check-landing-neutral.mjs
// Startuje `next start` z przykładowym SITE_URL i CONTENT_BASE_URL (domeny z nazwą serwisu - jak na produkcji), bez bazy i API.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.LANDING_CHECK_PORT ?? '3134';
const BASE = `http://localhost:${PORT}`;
const WEB = join(process.cwd(), 'apps', 'web');
// Każdy kształt adresu pod /t: poprawny token, sam prefiks, obcięty i wydłużony adres.
const PATHS = ['/t/dowolny-token-123', `/t/${'B'.repeat(43)}`, '/t', '/t/a/b', '/t/token/dalej'];
// W HTML: nazwa serwisu (dowolna wielkość liter), manifest, ikony serwisu, kolor marki, karta podglądu, opis.
const FORBIDDEN_HTML = [/unfooly/i, /manifest\.webmanifest/, /\/icon/, /theme-color/, /apple-touch-icon/, /property="og:/, /name="twitter:/, /name="description"/];
// W nagłówkach: nazwa serwisu (np. domena magazynu treści w CSP), technologia.
const FORBIDDEN_HEADERS = [/unfooly/i, /x-powered-by/i];

if (!existsSync(join(WEB, '.next', 'BUILD_ID'))) {
  console.error('Brak buildu produkcyjnego apps/web/.next - uruchom najpierw: npm run build --workspace=apps/web');
  process.exit(1);
}

const server = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', PORT], {
  cwd: WEB,
  env: { ...process.env, SITE_URL: 'https://unfooly.com', CONTENT_BASE_URL: 'https://content.unfooly.com', NODE_ENV: 'production' },
  stdio: 'ignore',
});
// Serwer, który padł przed gotowością (np. zajęty port - wtedy na porcie odpowiadałby CUDZY proces), to błąd, nie „gotowe”.
let exited = null;
server.on('exit', (code) => {
  exited = code ?? 1;
});

const problems = [];
try {
  const deadline = Date.now() + 60000;
  for (;;) {
    if (exited !== null) throw new Error(`next start zakończył się kodem ${exited} przed gotowością (port ${PORT} zajęty?)`);
    const ready = await fetch(`${BASE}/login`).then((response) => response.ok, () => false);
    if (ready && exited === null) break;
    if (Date.now() > deadline) throw new Error('next start nie wystartował w 60 s');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  for (const path of PATHS) {
    const response = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    const html = await response.text();
    const headers = [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n');
    if (response.status !== 200) problems.push(`${path}: status ${response.status} (oczekiwane 200 - neutralna strona)`);
    if (!/<title>Weryfikacja konta<\/title>/.test(html)) problems.push(`${path}: brak neutralnego <title>`);
    if (!/<meta name="robots" content="noindex, nofollow"/.test(html)) problems.push(`${path}: brak robots noindex, nofollow`);
    if (!/<link rel="icon" href="data:image\//.test(html)) problems.push(`${path}: brak neutralnej ikony w adresie data:`);
    for (const pattern of FORBIDDEN_HTML) if (pattern.test(html)) problems.push(`${path}: HTML zawiera ${pattern}`);
    for (const pattern of FORBIDDEN_HEADERS) if (pattern.test(headers)) problems.push(`${path}: nagłówki zawierają ${pattern}`);
    if (response.headers.get('set-cookie')) problems.push(`${path}: odpowiedź ustawia cookie`);
  }

  // Kontrola dodatnia: zwykła strona serwisu MA manifest, ikony i kartę podglądu (inaczej test wyżej nic by nie znaczył).
  const loginResponse = await fetch(`${BASE}/login`);
  const login = await loginResponse.text();
  // Magazyn treści dociera do middleware w tym uruchomieniu - bez tego sprawdzenie nagłówków /t byłoby puste.
  if (!(loginResponse.headers.get('content-security-policy') ?? '').includes('https://content.unfooly.com')) {
    problems.push('/login: CSP bez adresu magazynu treści (CONTENT_BASE_URL nie dotarł do serwera - kontrola nagłówków /t nic nie znaczy)');
  }
  for (const expected of [/manifest\.webmanifest/, /href="\/icon\.svg"/, /property="og:image" content="https:\/\/unfooly\.com\/og\/og-unfooly\.png"/]) {
    if (!expected.test(login)) problems.push(`/login: brak ${expected} (strony serwisu mają mieć manifest, ikony i og:image)`);
  }
} catch (error) {
  problems.push(String(error?.message ?? error));
} finally {
  server.kill();
}

for (const problem of problems) console.error(`BŁĄD: ${problem}`);
if (problems.length > 0) process.exit(1);
console.log(`OK: strona lądowania bez marki serwisu w HTML i nagłówkach (${PATHS.length} adresów pod /t); /login ma manifest, ikony i og:image.`);
