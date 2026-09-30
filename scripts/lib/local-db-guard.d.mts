export const LOCAL_DATABASE_HOSTS: string[];
export const LOCAL_REDIS_HOSTS: string[];
export const GUARDED_VARIABLES: string[];
export function databaseHost(url: unknown): string | null;
export function redisHost(url: unknown): string | null;
export function databaseProblems(env: Record<string, string | undefined>, options?: { required?: boolean }): string[];
export function refusalMessage(subject: string, problems: string[]): string;
export function assertLocalDatabase(
  subject: string,
  options?: { env?: Record<string, string | undefined>; required?: boolean; exit?: (code: number) => void; log?: (message: string) => void },
): void;
