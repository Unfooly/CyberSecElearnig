import { Role } from '@cyberszkolo/shared';

// Strona startowa zalogowanego użytkownika. Wynika WYŁĄCZNIE z tego, dokąd
// middleware.ts (PROTECTED_ROUTES) w ogóle wpuszcza daną rolę: /dashboard
// tylko ORG_ADMIN, /courses każdą rolę. Wysłanie roli na ścieżkę, której
// middleware jej nie dopuszcza, kończy się przekierowaniem do /login z
// wyczyszczonymi cookies (czyli wylogowaniem tuż po zalogowaniu).
// Zmieniając PROTECTED_ROUTES, zmień też to mapowanie.
export function homePathForRole(role: Role | undefined): string {
  return role === Role.ORG_ADMIN ? '/dashboard' : '/courses';
}

// Jedyne dozwolone cele przekierowania po zalogowaniu. Allowlista dokładnych
// wartości (a nie regex na "ścieżkę względną") wyklucza open redirect:
// `/\evil.com`, `/<TAB>/evil.com` czy `//evil.com` przeglądarka potrafi
// zinterpretować jako inny origin, a tu po prostu nie przechodzą.
const ALLOWED_HOME_PATHS: readonly string[] = ['/dashboard', '/courses'];

export function resolveHomePath(value: unknown): string {
  return typeof value === 'string' && ALLOWED_HOME_PATHS.includes(value) ? value : '/courses';
}
