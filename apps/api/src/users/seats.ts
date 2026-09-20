import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Limit licencji (Organization.seatsLimit): liczba kont w organizacji (każdy status i rola, także INVITED) nie może go przekroczyć.
// Egzekwowanie: pojedyncze zaproszenie, import CSV (podgląd i potwierdzenie). Plan można zmienić w ustawieniach organizacji
// (na razie ręcznie przez operatora; pełny billing Stripe to backlog).

/** Ścieżka ustawień w aplikacji web, do której odsyłamy po zmianę planu. */
export const SETTINGS_PATH = '/dashboard/settings';

export interface SeatUsage {
  limit: number;
  used: number;
  /** Ile jeszcze kont można dodać (nigdy ujemne). */
  available: number;
}

export function seatUsageOf(limit: number, used: number): SeatUsage {
  return { limit, used, available: Math.max(0, limit - used) };
}

/** Aktualne zużycie miejsc w kontekście organizacji (transakcja `runInOrgContext`). */
export async function loadSeatUsage(tx: Prisma.TransactionClient, organizationId: string): Promise<SeatUsage> {
  const [organization, used] = await Promise.all([
    tx.organization.findUnique({ where: { id: organizationId }, select: { seatsLimit: true } }),
    tx.user.count({ where: { organizationId } }),
  ]);
  return seatUsageOf(organization?.seatsLimit ?? 0, used);
}

/**
 * Serializuje zmiany liczby kont organizacji (blokada doradcza na czas transakcji): równoległe zaproszenia/importy nie
 * przekroczą limitu wyścigiem "oba widzą wolne miejsce". Wołać PRZED loadSeatUsage w tej samej transakcji.
 */
export async function lockSeats(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seats:${organizationId}`}))`;
}

export interface SeatLimitBody {
  code: 'SEAT_LIMIT';
  message: string;
  seatsLimit: number;
  seatsUsed: number;
  seatsAvailable: number;
  /** Ile miejsc potrzeba (import: liczba nowych kont); 1 dla pojedynczego zaproszenia. */
  seatsRequired: number;
  /** Ile miejsc brakuje. */
  seatsMissing: number;
  /** Gdzie zmienić plan (link do ustawień; Stripe później). */
  settingsPath: string;
}

/** Odpowiedź 409, gdy nowe konta nie mieszczą się w limicie: ile zostało, ile brakuje i gdzie zmienić plan. */
export function seatLimitError(usage: SeatUsage, required: number): HttpException {
  const missing = Math.max(0, required - usage.available);
  const base = `Wykorzystano ${usage.used} z ${usage.limit} licencji, zostało miejsc: ${usage.available}.`;
  const message =
    required === 1
      ? `Brak wolnych licencji. ${base} Aby dodać więcej osób, zmień plan w ustawieniach organizacji (${SETTINGS_PATH}).`
      : `Limit licencji nie pozwala na ten import: potrzeba ${required} miejsc, a ${base.charAt(0).toLowerCase()}${base.slice(1)} Brakuje ${missing}. Zmień plan w ustawieniach organizacji (${SETTINGS_PATH}) albo zmniejsz liczbę osób w pliku.`;
  const body: SeatLimitBody = {
    code: 'SEAT_LIMIT',
    message,
    seatsLimit: usage.limit,
    seatsUsed: usage.used,
    seatsAvailable: usage.available,
    seatsRequired: required,
    seatsMissing: missing,
    settingsPath: SETTINGS_PATH,
  };
  return new HttpException(body, HttpStatus.CONFLICT);
}

/** Sprawdza w transakcji, czy mieści się `required` nowych kont; inaczej rzuca 409 SEAT_LIMIT. Wymaga wcześniejszego lockSeats. */
export async function assertSeatsAvailable(tx: Prisma.TransactionClient, organizationId: string, required = 1): Promise<SeatUsage> {
  const usage = await loadSeatUsage(tx, organizationId);
  if (required > usage.available) {
    throw seatLimitError(usage, required);
  }
  return usage;
}
