import { Prisma } from '@prisma/client';
import { completeBatchIfDone } from './import/user-import.service';

/** Powód pokazywany administratorowi organizacji, której zaproszenie wygasło (ogólny: nie mówi, kto przejął adres ani dlaczego). */
export const INVITE_EXPIRED_REASON = 'Zaproszenie wygasło';

/** Zaproszenie, które nie zostało aktywowane, wygasa po tylu dniach (job w tle). */
export const INVITE_EXPIRY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const invitedAccountsCutoff = (now: Date): Date => new Date(now.getTime() - INVITE_EXPIRY_DAYS * DAY_MS);

/** Konto, które nie zostało aktywowane (nigdy nie ustawiono hasła ani nie potwierdzono e-maila). */
export const NEVER_ACTIVATED = { status: 'INVITED', emailVerifiedAt: null } as const;

export class InvitedAccountChangedError extends Error {
  constructor() {
    super('Konto zmieniło stan w trakcie wygaszania.');
    this.name = 'InvitedAccountChangedError';
  }
}

/**
 * Usuwa NIEAKTYWOWANE konta INVITED organizacji (wywołujący dobiera kryterium: 30 dni albo przejęcie adresu). W tej samej
 * transakcji wiersze importów wskazujące te konta dostają status EXPIRED (zaproszenie "wygasło"; robimy to PRZED usunięciem, bo
 * złożone FK zeruje userId), a partie, którym nic już nie czeka, są domykane. Konto, które w międzyczasie aktywowano, nie zostanie
 * usunięte: rozjazd liczby usuniętych i wybranych kont cofa całą transakcję (InvitedAccountChangedError).
 * Wszystko z jawnym `organizationId`; wywoływać wewnątrz runInOrgContext(organizationId).
 */
export async function expireInvitedAccounts(tx: Prisma.TransactionClient, organizationId: string, userIds: string[], now: Date): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await tx.userImportRow.findMany({
    where: { organizationId, userId: { in: userIds }, inviteStatus: { not: null } },
    select: { batchId: true },
    distinct: ['batchId'],
  });
  await tx.userImportRow.updateMany({
    where: { organizationId, userId: { in: userIds }, inviteStatus: { not: null } },
    data: { inviteStatus: 'EXPIRED', inviteReason: INVITE_EXPIRED_REASON },
  });
  const deleted = await tx.user.deleteMany({ where: { organizationId, id: { in: userIds }, ...NEVER_ACTIVATED } });
  if (deleted.count !== userIds.length) {
    throw new InvitedAccountChangedError();
  }
  for (const { batchId } of rows) {
    await completeBatchIfDone(tx, organizationId, batchId, now);
  }
  return deleted.count;
}
