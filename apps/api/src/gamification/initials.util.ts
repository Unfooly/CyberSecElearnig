/**
 * Fallback tożsamości na leaderboardzie dla userów bez firstName/lastName
 * (dziś: WSZYSCY userzy, bo żaden endpoint w tym zadaniu ich nie ustawia -
 * pola istnieją w schemacie, ale wypełni je dopiero przyszły ekran edycji
 * profilu, patrz README backlog). Zgodne z "firstName, lastName (lub
 * inicjały, jeśli zanonimizowane)" ze specyfikacji tego modułu.
 */
export function initialsFromEmail(email: string): { firstName: string; lastName: string } {
  const localPart = email.split('@')[0] ?? '';
  const segments = localPart.split(/[._-]+/).filter(Boolean);
  const firstName = segments[0]?.[0]?.toUpperCase() ?? '?';
  const lastName = segments[1]?.[0]?.toUpperCase() ?? '';
  return { firstName, lastName };
}
