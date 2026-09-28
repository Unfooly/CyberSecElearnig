// E2E w przeglądarce (Playwright) - SMOKE dowolnego modułu (B-128): import prawdziwym CLI, pracownik z przypisanym kursem, logowanie,
// katalog (tytuł i miniatura), odtwarzacz (nagłówek z tytułem, pierwszy blok, pasek „Dalej”) - bez błędów strony, konsoli i 5xx.
// Pełne przejście treści (odpowiedzi, dowody, zamknięcie sprawy) to osobny skrypt per moduł na wzór scripts/e2e-module-01.mjs -
// ten sprawdza, że NOWY moduł w ogóle działa od importu do pierwszego ekranu.
//
// Wymaga zbudowanych pakietów (`npm run build --workspace=packages/content`, `--workspace=apps/api`), bazy i Redisa jak e2e modułu 1.
// Użycie z katalogu repo:
//   npx dotenv -e .env -- node scripts/e2e-module.mjs <slug>          (domyślnie wyludzone-haslo)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SLUG = process.argv[2] ?? process.env.E2E_MODULE ?? 'wyludzone-haslo';
const modulePath = join(process.cwd(), 'packages', 'content', 'modules', SLUG, 'module.json');
if (!/^[a-z0-9-]{1,64}$/.test(SLUG) || !existsSync(modulePath)) {
  console.error(`Nie ma modułu "${SLUG}" w packages/content/modules.`);
  process.exit(1);
}
const MODULE = JSON.parse(readFileSync(modulePath, 'utf8'));

const API_PORT = process.env.E2E_API_PORT ?? '3111';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3110';
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const RUN = Date.now();
const DOMAIN = `module-smoke-${RUN}.test`;
const EMAIL = `pracownik@${DOMAIN}`;
const PASSWORD = 'E2e-Haslo-Testowe-1!';

const children = [];
let log = '';
const results = [];

function step(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) throw new Error(`Krok nieudany: ${name}`);
}

async function waitFor(check, what, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout: ${what}`);
}

function start(command, args, env, cwd) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, shell: false });
  children.push(child);
  child.stdout.on('data', (chunk) => (log += chunk.toString()));
  child.stderr.on('data', (chunk) => (log += chunk.toString()));
}

let prisma;
let browser;
let page;
let orgId;
let courseId;
let courseCreatedByThisRun = false;
try {
  start(process.execPath, ['apps/api/dist/main.js'], { PORT: API_PORT, FRONTEND_URL: WEB, MAILERSEND_API_TOKEN: '', BACKGROUND_JOBS_ENABLED: 'false', NODE_ENV: 'development' }, process.cwd());
  // `next dev`, nie `next start` - powód w scripts/e2e-module-01.mjs (ciasteczka Secure bez TLS).
  start(process.execPath, [join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', WEB_PORT], { API_URL: API }, join(process.cwd(), 'apps', 'web'));
  await waitFor(async () => (await fetch(`${API}/`)).status > 0, 'start API');
  await waitFor(async () => (await fetch(`${WEB}/`)).ok, 'start web');

  const contentImport = await import('../apps/api/dist/scripts/content-import.js');
  prisma = new PrismaClient();
  const modules = await contentImport.loadModules(join(process.cwd(), 'packages', 'content', 'modules'));
  const loaded = modules.find((m) => m.slug === SLUG);
  step(`content-import: moduł "${SLUG}" wczytany i zwalidowany`, !!loaded);
  const importResult = await prisma.$transaction((tx) => contentImport.importModule(tx, loaded));
  step('content-import: moduł zaimportowany do bazy', importResult.courseId != null && importResult.slug === SLUG, JSON.stringify(importResult));
  courseId = importResult.courseId;
  courseCreatedByThisRun = importResult.courseCreated;

  const org = await prisma.organization.create({ data: { name: `Module smoke ${RUN}`, status: 'ACTIVE' } });
  orgId = org.id;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    return tx.user.create({ data: { organizationId: org.id, email: EMAIL, passwordHash, role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${org.id}, true)`;
    await tx.courseAssignment.create({ data: { organizationId: org.id, userId: user.id, courseId } });
  });
  step('organizacja ACTIVE i pracownik z przypisanym kursem', true);

  browser = await chromium.launch();
  page = await (await browser.newContext()).newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${WEB}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/courses');
  step('logowanie pracownika kieruje na /courses', true);

  await page.getByText(MODULE.title, { exact: true }).first().waitFor();
  const thumbnails = await page.getByRole('img', { name: MODULE.title, exact: true }).count();
  step(`Katalog: kurs „${MODULE.title}”${MODULE.thumbnail ? ' z miniaturą' : ''}`, MODULE.thumbnail ? thumbnails >= 1 : true, `${thumbnails} miniatur`);

  await page.goto(`${WEB}/courses/${courseId}`);
  await page.getByRole('heading', { level: 1, name: MODULE.title, exact: true }).waitFor();
  step('Player: nagłówek z tytułem modułu', true);
  await page.getByTestId('player-content-area').waitFor();
  await page.getByTestId('player-bottombar').getByRole('button', { name: /Dalej|Zakończ/ }).first().waitFor();
  step(`Player: pierwszy blok (${MODULE.blocks[0].id}, ${MODULE.blocks[0].type}) i dolny pasek`, true);
  step('Bez błędów strony i odpowiedzi 5xx', problems.length === 0, problems.join(' | '));

  console.log(`\nWSZYSTKIE KROKI OK (${results.length})`);
} catch (error) {
  console.error(`\nBŁĄD: ${error.message}`);
  if (page) console.error('--- URL ---', page.url());
  console.error('--- ostatnie logi API/web ---\n' + log.split('\n').slice(-40).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  try {
    prisma ??= new PrismaClient();
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    // Kurs tylko, gdy stworzył go TEN przebieg (upsert po slugu - patrz scripts/e2e-module-01.mjs).
    if (courseId && courseCreatedByThisRun) await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  } catch (error) {
    console.error('Sprzątanie nie powiodło się:', error.message);
  }
}
