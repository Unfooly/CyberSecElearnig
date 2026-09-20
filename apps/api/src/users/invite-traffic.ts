import { Prisma } from '@prisma/client';

/**
 * Ruch zaproszeń organizacji od `since`: tokeny zaproszeń/resetów (prawdziwe zaproszenia) + wiadomości "ktoś próbował dodać Cię do
 * organizacji" (adres z kontem w innej organizacji). Oba rodzaje liczą się do JEDNEGO dobowego limitu (INVITE_DAILY_LIMIT_PER_ORG),
 * dzięki czemu ukrycie faktu istnienia konta nie daje nielimitowanego kanału sondowania i nie zdradza go tempem.
 */
export async function countInviteTraffic(tx: Prisma.TransactionClient, organizationId: string, since: Date): Promise<number> {
  const [tokens, notices] = await Promise.all([
    tx.passwordResetToken.count({ where: { organizationId, createdAt: { gte: since } } }),
    tx.inviteNotice.count({ where: { organizationId, createdAt: { gte: since } } }),
  ]);
  return tokens + notices;
}
