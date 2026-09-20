/**
 * Ważność linku potwierdzającego rejestrację na adres z cudzym nieaktywowanym zaproszeniem (24 h, jak link aktywacyjny). Wpis
 * `pending_admin_claims` powstaje razem z organizacją, więc wygasły wpis może być tylko w organizacji starszej niż ta wartość
 * (na tym opiera się zawężenie zapytania w `PendingOrganizationCleanupService.purgeExpiredClaims`).
 */
export const CLAIM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
