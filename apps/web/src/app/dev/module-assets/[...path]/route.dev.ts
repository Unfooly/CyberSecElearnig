import fs from 'node:fs/promises';
import path from 'node:path';

// Zasoby modułu 1 prosto z packages/content/modules/<slug>/assets - WYŁĄCZNIE dla podglądu (dev harness, scripts/layout-check.mjs),
// żeby nowe grafiki (np. sceny odprawy, D-084) dało się sprawdzić w przeglądarce PRZED publikacją w magazynie (--assets). Plik
// `.dev.ts`: trasa istnieje tylko z NEXT_PUBLIC_DEV_HARNESS=1 (next.config.mjs, pageExtensions) - jak page.dev.tsx; notFound niżej
// to druga linia obrony. Ścieżka to ALBO nazwa pliku źródłowego (pole przed publikacją, np. "scenes/odprawa-biurko.svg"), ALBO
// opublikowany klucz (np. "assets/wyludzone-haslo/scenes/korytarz.4c9c37ad.svg") - klucz tłumaczy assets.lock.json na plik źródłowy.
const MODULE_SLUG = 'wyludzone-haslo';
// Ten sam wzorzec ścieżki co treść (packages/content common.ts, apps/web content-assets.ts): bez "..", "//", schematu i backslasha.
const ASSET_PATH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

const notFound = () => new Response(null, { status: 404 });

export async function GET(_request: Request, { params }: { params: { path: string[] } }): Promise<Response> {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') return notFound();
  const requested = params.path.join('/');
  if (!ASSET_PATH.test(requested)) return notFound();

  const moduleDir = path.join(process.cwd(), '..', '..', 'packages', 'content', 'modules', MODULE_SLUG);
  const assetsDir = path.resolve(moduleDir, 'assets');
  let original = requested;
  try {
    const lock = JSON.parse(await fs.readFile(path.join(moduleDir, 'assets.lock.json'), 'utf8')) as { entries?: Record<string, { key: string; original: string }> };
    original = Object.values(lock.entries ?? {}).find((entry) => entry.key === requested)?.original ?? requested;
  } catch {
    // Brak locka (moduł jeszcze bez publikacji) - ścieżka jest nazwą pliku źródłowego.
  }
  if (!ASSET_PATH.test(original)) return notFound();

  const contentType = CONTENT_TYPES[original.slice(original.lastIndexOf('.') + 1).toLowerCase()];
  const target = path.resolve(assetsDir, ...original.split('/'));
  if (!contentType || !target.startsWith(`${assetsDir}${path.sep}`)) return notFound();
  try {
    const bytes = await fs.readFile(target);
    return new Response(bytes, {
      headers: {
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
        // SVG otwarty wprost (poza <img>) nie wykona skryptu ani nie pobierze niczego z zewnątrz.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'no-store',
      },
    });
  } catch {
    return notFound();
  }
}
