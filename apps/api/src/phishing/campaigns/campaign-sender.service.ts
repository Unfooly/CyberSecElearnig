import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { sha256Hex } from '../token-hash';
import { JobsService } from '../../jobs/jobs.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PhishingConfigService } from '../phishing-config.service';
import { buildTrackingUrl, composePhishingMail } from '../phishing-mail-composer';
import { PhishingMailMessage, PhishingMailTransport, PhishingTransportError } from '../transport/phishing-mail-transport';
import { SEND_TASK_NAME, SendTaskData } from './phishing-send-queue';

/** Maksymalna liczba prób wysyłki jednego maila (ponawiane są tylko błędy, przy których WIADOMO, że nic nie wyszło). */
export const MAX_SEND_ATTEMPTS = 3;
/** Zadanie może ruszyć nieco po oknie (opóźnienie workera); dalej niż to - odbiorca nie dostaje maila. */
export const WINDOW_GRACE_MS = 15 * 60_000;
/** Zadanie może ruszyć najwyżej tyle przed zaplanowanym momentem (zegary, zaokrąglenia opóźnienia). */
export const EARLY_TOLERANCE_MS = 60_000;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type SendOutcome ='SENT' | 'FAILED' | 'SKIPPED';

export { sha256Hex };

/**
 * Wysyłka JEDNEGO maila kampanii - "co najwyżej raz", idempotentna i odporna na wyścigi.
 *
 * 1. ZAJĘCIE (atomowe `updateMany` z warunkami stanu i kampanii): tylko jeden wykonawca ustawia claimedAt.
 *    Równoległe/powtórne wywołania dostają count = 0 i nic nie wysyłają. Warunek kampanii (SCHEDULED/RUNNING, okno)
 *    jest częścią tego samego zapytania, więc anulowanie kampanii wygrywa z wysyłką.
 * 2. WYSYŁKA poza transakcją (nie trzymamy połączenia z bazą podczas HTTP).
 * 3. WYNIK: sentAt (dostawca przyjął) albo failedAt + failureCode. Ponawiamy WYŁĄCZNIE błędy retryable (wiadomo, że
 *    wysyłka nie nastąpiła) - wtedy zwalniamy zajęcie i rzucamy błąd, żeby BullMQ ponowił zadanie (backoff).
 *    Timeout i inne niepewne wyniki => failedAt z kodem TIMEOUT_UNKNOWN / RESULT_UNKNOWN (dostawca mógł wysłać).
 *
 * Dane klienckie tylko przez runInOrgContext(organizationId) + jawny warunek organizationId (Zasada nr 1).
 * Do logów nie trafiają adresy ani treść - wyłącznie identyfikatory i kody.
 */
@Injectable()
export class CampaignSenderService implements OnModuleInit {
  private readonly logger = new Logger(CampaignSenderService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly transport: PhishingMailTransport,
    private readonly phishingConfig: PhishingConfigService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerTask({
      name: SEND_TASK_NAME,
      handler: async (data) => {
        const { organizationId, recipientId } = data as SendTaskData;
        if (!SAFE_ID.test(String(organizationId)) || !SAFE_ID.test(String(recipientId))) {
          this.logger.error('Zadanie wysyłki z nieprawidłowymi danymi - pominięte.');
          return 'SKIPPED';
        }
        return this.sendOne(organizationId, recipientId);
      },
    });
  }

  async sendOne(organizationId: string, recipientId: string, now: Date = new Date()): Promise<SendOutcome> {
    const rawToken = randomBytes(32).toString('base64url');

    const claim = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Blokada wiersza kampanii (FOR NO KEY UPDATE) na czas zajęcia: anulowanie (UPDATE kampanii) czeka na zajęcie albo
      // - gdy wygra pierwsze - zajęcie widzi status CANCELLED. Bez tego zajęcie i anulowanie mogłyby się minąć.
      // Blokada wyłączna (nie FOR SHARE): równoległe zajęcia tej samej kampanii ustawiają się w kolejkę zamiast
      // zakleszczać się przy późniejszym UPDATE statusu (transakcje są krótkie, wysyłka idzie poza nimi).
      await tx.$queryRaw`SELECT c."id" FROM "phishing_campaigns" c
        WHERE c."organizationId" = ${organizationId}
          AND c."id" = (SELECT r."campaignId" FROM "phishing_campaign_recipients" r WHERE r."id" = ${recipientId} AND r."organizationId" = ${organizationId})
        FOR NO KEY UPDATE`;
      const claimed = await tx.phishingCampaignRecipient.updateMany({
        where: {
          id: recipientId,
          organizationId,
          // Obrona w głąb: zadanie wykonane za wcześnie (błędne opóźnienie, ingerencja w Redisa) niczego nie wyśle -
          // odbiorcę odtworzy zadanie uzgadniające po terminie.
          scheduledAt: { lte: new Date(now.getTime() + EARLY_TOLERANCE_MS) },
          claimedAt: null,
          sentAt: null,
          failedAt: null,
          userId: { not: null },
          campaign: {
            organizationId,
            status: { in: ['SCHEDULED', 'RUNNING'] },
            windowEnd: { gte: new Date(now.getTime() - WINDOW_GRACE_MS) },
          },
        },
        data: { claimedAt: now, tokenHash: sha256Hex(rawToken), sendAttempts: { increment: 1 } },
      });
      if (claimed.count === 0) {
        return { kind: 'NOT_CLAIMED' as const, reason: await this.whyNotClaimed(tx, organizationId, recipientId, now) };
      }

      const recipient = await tx.phishingCampaignRecipient.findFirst({
        where: { id: recipientId, organizationId },
        select: { id: true, campaignId: true, userId: true, sendAttempts: true },
      });
      const campaign = recipient
        ? await tx.phishingCampaign.findFirst({
            where: { id: recipient.campaignId, organizationId },
            select: { id: true, subject: true, bodyHtml: true, senderName: true, senderLocalPart: true },
          })
        : null;
      // Tylko AKTYWNY pracownik: dezaktywowany/usunięty po utworzeniu kampanii nie dostaje maila.
      const user = recipient?.userId
        ? await tx.user.findFirst({ where: { id: recipient.userId, organizationId, status: 'ACTIVE' }, select: { email: true } })
        : null;
      if (!recipient || !campaign || !user) {
        return { kind: 'NOT_CLAIMED' as const, reason: 'RECIPIENT_REMOVED' as const };
      }
      // Pierwsza zajęta wiadomość przestawia kampanię na RUNNING (warunek SCHEDULED: idempotentne).
      await tx.phishingCampaign.updateMany({ where: { id: campaign.id, organizationId, status: 'SCHEDULED' }, data: { status: 'RUNNING' } });
      return { kind: 'CLAIMED' as const, recipient, campaign, email: user.email };
    });

    if (claim.kind === 'NOT_CLAIMED') {
      return this.settleUnclaimed(organizationId, recipientId, claim.reason);
    }

    const { recipient, campaign, email } = claim;
    let message: PhishingMailMessage | null = null;
    try {
      message = composePhishingMail({
        template: { subject: campaign.subject, bodyHtml: campaign.bodyHtml, senderName: campaign.senderName, senderLocalPart: campaign.senderLocalPart },
        recipientEmail: email,
        trackingUrl: buildTrackingUrl(this.phishingConfig.landingBaseUrl(), rawToken, this.phishingConfig.isProduction()),
        senderDomain: this.phishingConfig.senderDomain() ?? '',
      });
    } catch (error) {
      // Składanie wiadomości nie powiodło się PRZED wysyłką (zła konfiguracja/treść): wiadomo, że nic nie wyszło.
      // Komunikat pomijamy (mógłby zawierać adres).
      await this.markFailed(organizationId, recipientId, 'COMPOSE_FAILED');
      this.logger.error(`Nie złożono wiadomości (odbiorca ${recipientId}): ${(error as Error)?.name ?? 'Error'}`);
      await this.completeCampaignIfDone(organizationId, campaign.id, now);
      return 'FAILED';
    }

    // Ponowne sprawdzenie statusu tuż przed wysyłką: anulowanie, które zatwierdziło się po zajęciu, zatrzymuje wiadomość
    // (nic nie wyszło, więc to pewna porażka CANCELLED). Wiadomość wysłana w trakcie tego sprawdzenia już nie wróci.
    const stillActive = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaign.count({ where: { id: campaign.id, organizationId, status: { in: ['SCHEDULED', 'RUNNING'] } } }),
    );
    if (stillActive === 0) {
      await this.markFailed(organizationId, recipientId, 'CANCELLED');
      return 'FAILED';
    }

    let outcome: SendOutcome;
    try {
      const result = await this.transport.send(message);
      await this.recordSent(organizationId, recipientId, result.providerMessageId, now);
      outcome = 'SENT';
    } catch (error) {
      outcome = await this.handleSendError(organizationId, recipientId, recipient.sendAttempts, error);
    }

    await this.completeCampaignIfDone(organizationId, campaign.id, now);
    return outcome;
  }

  /** Dlaczego zajęcie się nie powiodło i co z tym odbiorcą zrobić (bez wysyłki). */
  private async whyNotClaimed(tx: Parameters<Parameters<TenantPrismaService['runInOrgContext']>[1]>[0], organizationId: string, recipientId: string, now: Date) {
    const recipient = await tx.phishingCampaignRecipient.findFirst({
      where: { id: recipientId, organizationId },
      select: { claimedAt: true, sentAt: true, failedAt: true, userId: true, scheduledAt: true },
    });
    if (!recipient || recipient.claimedAt || recipient.sentAt || recipient.failedAt) {
      return 'ALREADY_HANDLED' as const; // nie istnieje, obsłużony albo obsługiwany przez inny wykonawca
    }
    if (recipient.scheduledAt.getTime() > now.getTime() + EARLY_TOLERANCE_MS) {
      return 'TOO_EARLY' as const; // zadanie ruszyło przed czasem: nic nie robimy, odtworzy je zadanie uzgadniające
    }
    if (!recipient.userId) {
      return 'RECIPIENT_REMOVED' as const;
    }
    const campaign = await tx.phishingCampaign.findFirst({
      where: { recipients: { some: { id: recipientId, organizationId } }, organizationId },
      select: { status: true, windowEnd: true },
    });
    if (!campaign || campaign.status === 'CANCELLED') {
      return 'CANCELLED' as const;
    }
    if (campaign.status === 'COMPLETED' || campaign.windowEnd.getTime() + WINDOW_GRACE_MS < now.getTime()) {
      return 'WINDOW_EXPIRED' as const;
    }
    return 'ALREADY_HANDLED' as const;
  }

  private async settleUnclaimed(
    organizationId: string,
    recipientId: string,
    reason: 'ALREADY_HANDLED' | 'TOO_EARLY' | 'RECIPIENT_REMOVED' | 'CANCELLED' | 'WINDOW_EXPIRED',
  ): Promise<SendOutcome> {
    if (reason === 'ALREADY_HANDLED' || reason === 'TOO_EARLY') {
      return 'SKIPPED';
    }
    // Nic nie wysłano - oznaczamy odbiorcę jako nieudanego z przyczyną znaną (NIE "niepewne").
    await this.markFailed(organizationId, recipientId, reason);
    const recipient = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaignRecipient.findFirst({ where: { id: recipientId, organizationId }, select: { campaignId: true } }),
    );
    if (recipient) {
      await this.completeCampaignIfDone(organizationId, recipient.campaignId, new Date());
    }
    return 'FAILED';
  }

  private async recordSent(organizationId: string, recipientId: string, providerMessageId: string | null, now: Date): Promise<void> {
    // Dwie próby: po udanej wysyłce nie chcemy zostawić zajęcia bez wyniku przez chwilową awarię bazy
    // (zadanie uzgadniające domknęłoby je jako INTERRUPTED_UNKNOWN - niepewne, choć wiadomość poszła).
    for (let attempt = 1; ; attempt += 1) {
      try {
        const updated = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
          tx.phishingCampaignRecipient.updateMany({
            where: { id: recipientId, organizationId, sentAt: null, failedAt: null, claimedAt: { not: null } },
            data: { sentAt: now, providerMessageId: providerMessageId?.slice(0, 200) ?? null },
          }),
        );
        if (updated.count === 0) {
          // Zajęcie zostało w międzyczasie domknięte (zadanie uzgadniające: INTERRUPTED_UNKNOWN) - wiadomość wyszła,
          // ale wynik zostaje "niepewny" (bezpieczna strona). Sygnał do logów, bez danych osobowych.
          this.logger.warn(`Wynik wysyłki nie zapisany - zajęcie już domknięte (odbiorca ${recipientId}).`);
        }
        return;
      } catch (error) {
        if (attempt >= 2) {
          this.logger.error(`Nie zapisano wyniku wysyłki (odbiorca ${recipientId}): ${(error as Error).name}`);
          throw new PhishingTransportError('Nie zapisano wyniku wysyłki.', false, 'RESULT_UNKNOWN');
        }
      }
    }
  }

  private async handleSendError(organizationId: string, recipientId: string, attempts: number, error: unknown): Promise<SendOutcome> {
    if (error instanceof PhishingTransportError) {
      if (error.retryable && attempts < MAX_SEND_ATTEMPTS) {
        // Wiadomo, że nic nie wyszło: zwalniamy zajęcie i oddajemy zadanie BullMQ do ponowienia (backoff).
        await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
          tx.phishingCampaignRecipient.updateMany({
            where: { id: recipientId, organizationId, sentAt: null, failedAt: null, claimedAt: { not: null } },
            data: { claimedAt: null, tokenHash: null },
          }),
        );
        this.logger.warn(`Wysyłka odroczona (odbiorca ${recipientId}, próba ${attempts}/${MAX_SEND_ATTEMPTS}): ${error.code}`);
        throw error;
      }
      await this.markFailed(organizationId, recipientId, error.code);
      this.logger.warn(`Wysyłka nieudana (odbiorca ${recipientId}): ${error.code}`);
      return 'FAILED';
    }
    // Nieoczekiwany błąd w trakcie wysyłki (nie z transportu): wynik nieznany - wolimy "niepewne" niż ryzyko duplikatu.
    await this.markFailed(organizationId, recipientId, 'RESULT_UNKNOWN');
    this.logger.error(`Wysyłka przerwana (odbiorca ${recipientId}): RESULT_UNKNOWN (${(error as Error)?.name ?? 'Error'})`);
    return 'FAILED';
  }

  private async markFailed(organizationId: string, recipientId: string, code: string): Promise<void> {
    await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaignRecipient.updateMany({
        where: { id: recipientId, organizationId, sentAt: null, failedAt: null },
        data: { failedAt: new Date(), failureCode: code.slice(0, 40) },
      }),
    );
  }

  /** Kampania jest ZAKOŃCZONA, gdy nikt nie czeka na wynik (atomowo: tylko z aktywnego statusu). */
  async completeCampaignIfDone(organizationId: string, campaignId: string, now: Date): Promise<boolean> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const open = await tx.phishingCampaignRecipient.count({
        where: { organizationId, campaignId, sentAt: null, failedAt: null },
      });
      if (open > 0) {
        return false;
      }
      const updated = await tx.phishingCampaign.updateMany({
        where: { id: campaignId, organizationId, status: { in: ['SCHEDULED', 'RUNNING'] } },
        data: { status: 'COMPLETED', completedAt: now },
      });
      return updated.count > 0;
    });
  }
}
