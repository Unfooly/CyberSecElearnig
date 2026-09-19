import { isSafeId } from '@/lib/safe-id';

const AUDIENCE_TYPES = ['ALL', 'DEPARTMENTS', 'USERS'];

// Grono odbiorców budowane z jawnej allowlisty pól (nic więcej nie przechodzi do API); walidację biznesową
// (przynależność do organizacji, spójność typu i list) robi apps/api. null = nieprawidłowy kształt.
export function buildAudience(input: unknown): Record<string, unknown> | null {
  const audience = input as { type?: unknown; departmentIds?: unknown; userIds?: unknown } | null;
  if (!audience || typeof audience.type !== 'string' || !AUDIENCE_TYPES.includes(audience.type)) {
    return null;
  }
  const ids = (value: unknown) => (Array.isArray(value) && value.every(isSafeId) ? (value as string[]) : null);
  const departmentIds = audience.departmentIds === undefined ? undefined : ids(audience.departmentIds);
  const userIds = audience.userIds === undefined ? undefined : ids(audience.userIds);
  if (departmentIds === null || userIds === null) {
    return null;
  }
  return {
    type: audience.type,
    ...(departmentIds ? { departmentIds } : {}),
    ...(userIds ? { userIds } : {}),
  };
}
