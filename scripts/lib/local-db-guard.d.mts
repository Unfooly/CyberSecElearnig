export const LOCAL_DATABASE_HOSTS: string[];
export const DATABASE_URL_VARIABLES: string[];
export function databaseHost(url: unknown): string | null;
export function databaseProblems(env: Record<string, string | undefined>, options?: { required?: boolean }): string[];
export function assertLocalDatabase(
  scriptName: string,
  options?: { env?: Record<string, string | undefined>; required?: boolean; exit?: (code: number) => void; log?: (message: string) => void },
): void;
