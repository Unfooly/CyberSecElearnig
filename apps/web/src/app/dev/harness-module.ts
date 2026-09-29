import fs from 'node:fs';
import path from 'node:path';

// Moduł treści dla stron podglądu (dev harness: player-harness, courses-harness, module-assets) - B-128: dowolny moduł przez
// parametr `?module=<slug>` (trasa zasobów: /dev/module-assets/<slug>/...), domyślnie moduł 1 (dotychczasowe wywołania
// scripts/layout-check.mjs bez parametru działają bez zmian). Slug tylko z białej listy znaków i tylko istniejący katalog
// packages/content/modules/<slug> z module.json - nic spoza tego katalogu (strony i tak istnieją wyłącznie z NEXT_PUBLIC_DEV_HARNESS=1).
export const DEFAULT_MODULE_SLUG = 'wyludzone-haslo';
const SLUG = /^[a-z0-9-]{1,64}$/;

export const modulesRoot = () => path.join(process.cwd(), '..', '..', 'packages', 'content', 'modules');
// Moduły podglądu (D-115): `dev-*` z packages/content/dev-modules - treść nowych typów bloków do harnessu i layout-check, zanim powstanie
// treść prawdziwego modułu. Import treści ich nie czyta (tylko packages/content/modules).
export const devModulesRoot = () => path.join(process.cwd(), '..', '..', 'packages', 'content', 'dev-modules');

/** Katalog modułu dla sluga z parametru (brak parametru = moduł 1) albo null, gdy slug niepoprawny albo moduł nie istnieje. */
export function harnessModuleDir(param: string | undefined): { slug: string; dir: string } | null {
  const slug = param ?? DEFAULT_MODULE_SLUG;
  if (!SLUG.test(slug)) return null;
  const dir = path.join(slug.startsWith('dev-') ? devModulesRoot() : modulesRoot(), slug);
  return fs.existsSync(path.join(dir, 'module.json')) ? { slug, dir } : null;
}
