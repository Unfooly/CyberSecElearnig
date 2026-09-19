import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CampaignSenderService, WINDOW_GRACE_MS } from './campaign-sender.service';
import { PhishingSendQueue } from './phishing-send-queue';

export const CAMPAIGN_RECONCILE_JOB = 'phishing-campaign-reconcile';
/** Zajęcie bez wyniku dłużej niż to = wykonawca zginął w trakcie (restart, awaria): wynik NIEPEWNY. */
export const STALE_CLAIM_MS = 10 * 60_000;
/** Odbiorca po terminie o tyle jest uznany za "zgubione zadanie" (Redis wyczyszczony, błąd kolejkowania). */
export const OVERDUE_MS = 2 * 60_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
/** Anulowane kampanie uzgadniamy jeszcze tyle czasu (domknięcie wiszących odbiorców), potem przestają obciążać zadanie. */
export const CANCELLED_RECONCILE_MS = 7 * 24 * 3_600_000;
const MAX_REQUEUE_PER_CAMPAIGN = 2000;

export interface ReconcileReport {
  campaigns: number;
  staleClaims: number;
  expired: number;
  requeued: number;
  completed: number;
  errors: number;
}

/**
 * Zadanie cykliczne (co 5 min, UTC) uzgadniające stan kampanii z kolejką - siatka bezpieczeństwa dla:
 *  - zgubionych zadań (Redis wyczyszczony/niedostępny przy starcie kampanii): zaległy odbiorca dostaje zadanie
 *    (deduplikacja po id, więc zdrowe zadania nie są dublowane),
 *  - zajęć bez wyniku (proces zginął po zajęciu): INTERRUPTED_UNKNOWN - "niepewne", NIE ponawiamy ("co najwyżej raz"),
 *  - odbiorców po końcu okna: WINDOW_EXPIRED,
 *  - kampanii bez oczekujących odbiorców: COMPLETED.
 *
 * Idempotentne i race-safe (każda zmiana to atomowy updateMany z warunkiem stanu). Lista aktywnych kampanii
 * wszystkich organizacji to JEDYNE zapytanie międzyorganizacyjne (TenantPrismaService.listCampaignsToReconcile: bypass w
 * polityce SELECT phishing_campaigns, wynik to tylko id i organizationId); cała reszta pracy idzie w kontekście organizacji
 * kampanii. Kampanie anulowane (7 dni) są uzgadniane tylko po to, by domknąć wiszących odbiorców.
 */
@Injectable()
export class CampaignReconcileService implements OnModuleInit {
  private readonly logger = new Logger(CampaignReconcileService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sender: CampaignSenderService,
    private readonly queue: PhishingSendQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: CAMPAIGN_RECONCILE_JOB, cron: '*/5 * * * *', handler: () => this.reconcile(new Date()) });
  }

  async reconcile(now: Date): Promise<ReconcileReport> {
    const report: ReconcileReport = { campaigns: 0, staleClaims: 0, expired: 0, requeued: 0, completed: 0, errors: 0 };
    const cancelledSince = new Date(now.getTime() - CANCELLED_RECONCILE_MS);

    // Strony po id (kursor): przy dużej liczbie aktywnych kampanii żadna nie jest głodzona.
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await this.tenantPrisma.listCampaignsToReconcile(cancelledSince, cursor, PAGE_SIZE);
      report.campaigns += batch.length;
      for (const campaign of batch) {
        try {
          await this.reconcileCampaign(campaign.organizationId, campaign.id, now, report);
        } catch (error) {
          // Błąd jednej kampanii nie blokuje reszty; bez danych osobowych (nazwa błędu i kod, bez komunikatu z zapytaniem).
          report.errors += 1;
          const { name, code } = error as { name?: string; code?: string };
          this.logger.error(`Uzgadnianie kampanii ${campaign.id} nie powiodło się: ${name ?? 'Error'}${code ? ` (${code})` : ''}`);
        }
      }
      if (batch.length < PAGE_SIZE) {
        break;
      }
      cursor = batch[batch.length - 1].id;
    }
    return report;
  }

  private async reconcileCampaign(organizationId: string, campaignId: string, now: Date, report: ReconcileReport): Promise<void> {
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
    const overdueBefore = new Date(now.getTime() - OVERDUE_MS);

    const { requeue } = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const campaign = await tx.phishingCampaign.findFirst({ where: { id: campaignId, organizationId }, select: { windowEnd: true, status: true } });
      if (!campaign || (campaign.status !== 'SCHEDULED' && campaign.status !== 'RUNNING' && campaign.status !== 'CANCELLED')) {
        return { requeue: [] as { id: string }[] };
      }

      const stale = await tx.phishingCampaignRecipient.updateMany({
        where: { organizationId, campaignId, claimedAt: { lt: staleBefore }, sentAt: null, failedAt: null },
        data: { failedAt: now, failureCode: 'INTERRUPTED_UNKNOWN' },
      });
      report.staleClaims += stale.count;

      if (campaign.status === 'CANCELLED') {
        // Anulowana kampania nie ma już nic do wysłania: domykamy odbiorców, którym anulowanie nie zdążyło nadać wyniku
        // (zwolnione claimy po ponowieniu), żeby "oczekuje" zeszło do zera.
        const closed = await tx.phishingCampaignRecipient.updateMany({
          where: { organizationId, campaignId, claimedAt: null, sentAt: null, failedAt: null },
          data: { failedAt: now, failureCode: 'CANCELLED' },
        });
        report.expired += closed.count;
        return { requeue: [] as { id: string }[] };
      }

      let pending: { id: string }[] = [];
      if (campaign.windowEnd.getTime() + WINDOW_GRACE_MS < now.getTime()) {
        const expired = await tx.phishingCampaignRecipient.updateMany({
          where: { organizationId, campaignId, claimedAt: null, sentAt: null, failedAt: null },
          data: { failedAt: now, failureCode: 'WINDOW_EXPIRED' },
        });
        report.expired += expired.count;
      } else {
        pending = await tx.phishingCampaignRecipient.findMany({
          where: { organizationId, campaignId, claimedAt: null, sentAt: null, failedAt: null, userId: { not: null }, scheduledAt: { lt: overdueBefore } },
          select: { id: true },
          take: MAX_REQUEUE_PER_CAMPAIGN,
        });
      }
      return { requeue: pending };
    });

    if (requeue.length > 0) {
      // Deduplikacja po id odbiorcy: istniejące zadanie zostaje, brakujące powstaje (natychmiast).
      // replaceFinished: zakończone/nieudane zadanie tego odbiorcy (zostaje w Redisie) nie może zablokować odtworzenia.
      await this.queue.enqueue(
        requeue.map((recipient) => ({ organizationId, recipientId: recipient.id, delayMs: 0 })),
        { replaceFinished: true },
      );
      report.requeued += requeue.length;
    }
    if (await this.sender.completeCampaignIfDone(organizationId, campaignId, now)) {
      report.completed += 1;
    }
  }
}
