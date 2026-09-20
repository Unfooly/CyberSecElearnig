import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PhishingAudienceType, PhishingCampaign, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AudienceDto, CAMPAIGN_LIMITS, CreateCampaignDto } from '../dto/campaign.dto';
import { PhishingConfigService } from '../phishing-config.service';
import { PhishingTemplatesService } from '../phishing-templates.service';
import { isUncertainFailureCode } from '../transport/phishing-mail-transport';
import { PhishingSendQueue } from './phishing-send-queue';
import { peakInAnyWindow, planSendTimes, shuffled } from './send-planner';

const DAY_MS = 24 * 3_600_000;
/** Bezpiecznik zapytania o istniejące wysyłki (5000 odbiorców x 10 aktywnych kampanii x zapas). */
const MAX_DAILY_LIMIT_ROWS = 100_000;

export const MIN_WINDOW_MS = 10 * 60_000;
export const MAX_WINDOW_MS = 30 * 24 * 3_600_000;
export const MAX_START_LEAD_MS = 60 * 24 * 3_600_000;
// Kreator wysyła "teraz" jako początek okna - zegary klienta i serwera mogą się rozjechać.
export const START_PAST_TOLERANCE_MS = 5 * 60_000;
/** Ochrona przed zalewem kolejki: tyle kampanii naraz może być aktywnych w organizacji. */
export const MAX_ACTIVE_CAMPAIGNS = 10;

const err = (code: string, message: string) => ({ code, message });
export const TRANSPORT_NOT_CONFIGURED = err('TRANSPORT_NOT_CONFIGURED', 'Wysyłka symulacji nie jest skonfigurowana. Skontaktuj się z administratorem platformy.');
export const INVALID_AUDIENCE = err('INVALID_AUDIENCE', 'Nieprawidłowa lista odbiorców.');
export const NO_RECIPIENTS = err('NO_RECIPIENTS', 'Brak odbiorców: wybrane grono nie zawiera aktywnych pracowników.');
export const TOO_MANY_RECIPIENTS = err('TOO_MANY_RECIPIENTS', `Kampania może mieć najwyżej ${CAMPAIGN_LIMITS.maxRecipients} odbiorców.`);
export const INVALID_WINDOW = err('INVALID_WINDOW', 'Nieprawidłowe okno wysyłki.');
export const TOO_MANY_ACTIVE_CAMPAIGNS = err('TOO_MANY_ACTIVE_CAMPAIGNS', `Można mieć najwyżej ${MAX_ACTIVE_CAMPAIGNS} aktywnych kampanii naraz.`);
export const DUPLICATE_CAMPAIGN = err('DUPLICATE_CAMPAIGN', 'Taka sama kampania została właśnie utworzona. Sprawdź listę kampanii.');
/** Identyczna kampania (nazwa, szablon, grono, okno) utworzona w tym czasie jest traktowana jako ponowione żądanie. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
export const DAILY_SEND_LIMIT = err('DAILY_SEND_LIMIT', 'Przekroczony dobowy limit wysyłek symulacji.');
/** Limit wysyłek na kroczące 24 h = ten mnożnik x liczba licencji organizacji (seatsLimit). */
export const DAILY_SEND_LIMIT_FACTOR = 2;
export const CAMPAIGN_NOT_ACTIVE = err('CAMPAIGN_NOT_ACTIVE', 'Kampania jest już zakończona lub anulowana.');

export interface CampaignCounts {
  total: number;
  /** Czeka na wysyłkę albo jest w trakcie. */
  pending: number;
  sent: number;
  /** Nieudane z PEWNOŚCIĄ, że nic nie wyszło (odrzucony adres, anulowanie, koniec okna...). */
  failed: number;
  /** Nieudane, ale dostawca MÓGŁ wysłać (timeout, przerwane zadanie) - "niepewne". */
  uncertain: number;
}

export interface CampaignView {
  id: string;
  name: string;
  status: string;
  audienceType: PhishingAudienceType;
  templateName: string;
  subject: string;
  senderName: string;
  senderAddress: string | null;
  windowStart: Date;
  windowEnd: Date;
  createdAt: Date;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdByEmail: string;
  counts: CampaignCounts;
  /** Rozbicie nieudanych na kody (bez danych osobowych) - do szczegółów kampanii. */
  failures: { code: string; count: number; uncertain: boolean }[];
}

interface ResolvedRecipient {
  id: string;
  departmentId: string | null;
  departmentName: string | null;
}

/**
 * Kampanie symulacji (jednorazowe). Każde zapytanie ma jawny warunek organizationId z JWT i idzie przez
 * runInOrgContext (RLS jako druga linia obrony). Lista odbiorców jest rozwiązywana WYŁĄCZNIE w obrębie organizacji
 * (obce identyfikatory => ten sam błąd INVALID_AUDIENCE, bez ujawniania, co istnieje).
 */
@Injectable()
export class PhishingCampaignsService {
  private readonly logger = new Logger(PhishingCampaignsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly templates: PhishingTemplatesService,
    private readonly phishingConfig: PhishingConfigService,
    private readonly queue: PhishingSendQueue,
  ) {}

  /** Liczba odbiorców dla wybranego grona (krok kreatora, bez zapisu). */
  async previewAudience(organizationId: string, audience: AudienceDto): Promise<{ count: number; limit: number }> {
    const recipients = await this.tenantPrisma.runInOrgContext(organizationId, (tx) => this.resolveRecipients(tx, organizationId, audience));
    return { count: recipients.length, limit: CAMPAIGN_LIMITS.maxRecipients };
  }

  async create(organizationId: string, actor: AuthenticatedUser, dto: CreateCampaignDto, now: Date = new Date()): Promise<CampaignView> {
    if (!this.phishingConfig.status().configured) {
      throw new ConflictException(TRANSPORT_NOT_CONFIGURED);
    }
    const start = new Date(dto.windowStart);
    const end = new Date(dto.windowEnd);
    this.validateWindow(start, end, now);

    const template = await this.templates.get(organizationId, dto.templateId); // 404, gdy szablon niewidoczny dla organizacji
    const from = new Date(Math.max(start.getTime(), now.getTime()));
    const actorEmail = await this.actorEmail(organizationId, actor);

    const { campaign, scheduled } = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Tworzenie kampanii organizacji jest serializowane blokadą (do końca transakcji): limit aktywnych kampanii i
      // wykrywanie duplikatu nie mogą być ominięte przez równoległe żądania (READ COMMITTED).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phishing-campaign:${organizationId}`}))`;
      const active = await tx.phishingCampaign.count({ where: { organizationId, status: { in: ['SCHEDULED', 'RUNNING'] } } });
      if (active >= MAX_ACTIVE_CAMPAIGNS) {
        throw new ConflictException(TOO_MANY_ACTIVE_CAMPAIGNS);
      }
      // Idempotencja: ponowione żądanie (podwójne kliknięcie, retry proxy) tej samej kampanii nie wyśle drugiego phishingu.
      const duplicate = await tx.phishingCampaign.count({
        where: {
          organizationId,
          name: dto.name,
          templateId: template.id,
          audienceType: dto.audience.type,
          windowStart: start,
          windowEnd: end,
          createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
        },
      });
      if (duplicate > 0) {
        throw new ConflictException(DUPLICATE_CAMPAIGN);
      }
      const recipients = await this.resolveRecipients(tx, organizationId, dto.audience);
      if (recipients.length === 0) {
        throw new BadRequestException(NO_RECIPIENTS);
      }
      if (recipients.length > CAMPAIGN_LIMITS.maxRecipients) {
        throw new BadRequestException(TOO_MANY_RECIPIENTS);
      }
      // Czasy są posortowane, a odbiorcy przychodzą w kolejności z bazy - tasujemy czasy, żeby kolejność wysyłki nie
      // wynikała z kolejności założenia kont (pracownicy nie mogą przewidzieć, kto dostanie wiadomość następny).
      const times = shuffled(planSendTimes(recipients.length, from, end));
      await this.assertDailyLimit(tx, organizationId, times);

      const created = await tx.phishingCampaign.create({
        data: {
          organizationId,
          name: dto.name,
          audienceType: dto.audience.type,
          templateId: template.id,
          templateName: template.name,
          subject: template.subject,
          bodyHtml: template.bodyHtml,
          lessonHtml: template.lessonHtml,
          senderName: template.senderName,
          senderLocalPart: template.senderLocalPart,
          windowStart: start,
          windowEnd: end,
          createdByUserId: actor.userId,
          createdByEmail: actorEmail,
        },
      });
      const rows = recipients.map((recipient, index) => ({
        id: randomUUID(),
        organizationId,
        campaignId: created.id,
        userId: recipient.id,
        departmentId: recipient.departmentId,
        departmentName: recipient.departmentName,
        scheduledAt: times[index],
      }));
      await tx.phishingCampaignRecipient.createMany({ data: rows });
      return { campaign: created, scheduled: rows.map((row) => ({ recipientId: row.id, scheduledAt: row.scheduledAt })) };
    });

    // Kolejka POZA transakcją. Niepowodzenie (Redis niedostępny) nie cofa kampanii: zadanie uzgadniające
    // dołoży zadania dla zaległych odbiorców.
    try {
      await this.queue.enqueue(scheduled.map((item) => ({ organizationId, recipientId: item.recipientId, delayMs: item.scheduledAt.getTime() - now.getTime() })));
    } catch (error) {
      this.logger.warn(`Nie dodano zadań wysyłki do kolejki (kampania ${campaign.id}): ${(error as Error).message}. Zrobi to zadanie uzgadniające.`);
    }
    return this.get(organizationId, campaign.id);
  }

  async list(organizationId: string): Promise<CampaignView[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const campaigns = await tx.phishingCampaign.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
      const stats = await this.statsFor(tx, organizationId, campaigns.map((campaign) => campaign.id));
      return campaigns.map((campaign) => this.toView(campaign, stats.get(campaign.id)));
    });
  }

  async get(organizationId: string, id: string): Promise<CampaignView> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const campaign = await tx.phishingCampaign.findFirst({ where: { id, organizationId } });
      if (!campaign) {
        throw new NotFoundException('Nie znaleziono kampanii.');
      }
      const stats = await this.statsFor(tx, organizationId, [campaign.id]);
      return this.toView(campaign, stats.get(campaign.id));
    });
  }

  /**
   * Anulowanie: kampania -> CANCELLED (atomowo, tylko z aktywnego statusu), niewysłani odbiorcy -> failedAt CANCELLED
   * (znana przyczyna, nie "niepewne"), zadania usuwane z kolejki. Wiadomość już zajęta do wysyłki dokończy się
   * (nie da się jej cofnąć); nowe zajęcia są blokowane warunkiem statusu kampanii w sendOne.
   */
  async cancel(organizationId: string, id: string, now: Date = new Date()): Promise<CampaignView> {
    const cancelledIds = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const updated = await tx.phishingCampaign.updateMany({
        where: { id, organizationId, status: { in: ['SCHEDULED', 'RUNNING'] } },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      if (updated.count === 0) {
        const exists = await tx.phishingCampaign.findFirst({ where: { id, organizationId }, select: { id: true } });
        throw exists ? new ConflictException(CAMPAIGN_NOT_ACTIVE) : new NotFoundException('Nie znaleziono kampanii.');
      }
      const pending = await tx.phishingCampaignRecipient.findMany({
        where: { organizationId, campaignId: id, claimedAt: null, sentAt: null, failedAt: null },
        select: { id: true },
      });
      const ids = pending.map((recipient) => recipient.id);
      await tx.phishingCampaignRecipient.updateMany({
        where: { organizationId, campaignId: id, id: { in: ids }, claimedAt: null, sentAt: null, failedAt: null },
        data: { failedAt: now, failureCode: 'CANCELLED' },
      });
      return ids;
    });

    try {
      await this.queue.remove(cancelledIds);
    } catch (error) {
      // Nie jest krytyczne: zadanie, które jednak ruszy, nie zajmie odbiorcy (kampania CANCELLED / odbiorca z wynikiem).
      this.logger.warn(`Nie usunięto zadań z kolejki po anulowaniu (kampania ${id}): ${(error as Error).message}`);
    }
    return this.get(organizationId, id);
  }

  /**
   * Limit globalny organizacji: DAILY_SEND_LIMIT_FACTOR x seatsLimit WYSYŁEK na dowolne kroczące 24 h. Liczymy po
   * ZAPLANOWANYCH momentach wysyłki (scheduledAt), nie po dacie utworzenia: kampanie tworzone w różne dni z tym samym
   * oknem wysyłki i tak sumują się w dniu wysyłki. Sprawdzamy, czy po dołożeniu momentów nowej kampanii jakiekolwiek
   * 24 h (okno przesuwne) zawiera więcej wysyłek niż limit. Odbiorcy anulowani przed wysyłką (failureCode CANCELLED)
   * nie zużywają limitu; świeżo anulowana kampania zużywa go do czasu domknięcia odbiorców (zachowanie konserwatywne).
   * Sprawdzane przy uruchamianiu kampanii, w transakcji pod blokadą organizacji - równoległe żądania go nie obejdą.
   */
  private async assertDailyLimit(tx: Prisma.TransactionClient, organizationId: string, newTimes: Date[]): Promise<void> {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { seatsLimit: true } });
    const limit = DAILY_SEND_LIMIT_FACTOR * (organization?.seatsLimit ?? 0);
    const newMs = newTimes.map((time) => time.getTime());
    const min = Math.min(...newMs);
    const max = Math.max(...newMs);
    const existing = await tx.phishingCampaignRecipient.findMany({
      where: {
        organizationId,
        scheduledAt: { gte: new Date(min - DAY_MS), lte: new Date(max + DAY_MS) },
        OR: [{ failureCode: null }, { failureCode: { not: 'CANCELLED' } }],
      },
      select: { scheduledAt: true },
      take: MAX_DAILY_LIMIT_ROWS,
    });
    const peak = peakInAnyWindow([...existing.map((row) => row.scheduledAt.getTime()), ...newMs], DAY_MS);
    if (peak > limit) {
      const peakExisting = peakInAnyWindow(existing.map((row) => row.scheduledAt.getTime()), DAY_MS);
      throw new ConflictException({
        code: DAILY_SEND_LIMIT.code,
        message: `Limit wysyłek symulacji to ${limit} na dobę (kroczące 24 h). Ta kampania (${newTimes.length} odbiorców) przekroczyłaby go: w najbardziej obciążonej dobie byłoby ${peak} wysyłek (już zaplanowanych: ${peakExisting}). Zmniejsz grono albo przesuń okno wysyłki.`,
      });
    }
  }

  private validateWindow(start: Date, end: Date, now: Date): void {
    const valid =
      Number.isFinite(start.getTime()) &&
      Number.isFinite(end.getTime()) &&
      end.getTime() - start.getTime() >= MIN_WINDOW_MS &&
      end.getTime() - start.getTime() <= MAX_WINDOW_MS &&
      start.getTime() >= now.getTime() - START_PAST_TOLERANCE_MS &&
      start.getTime() <= now.getTime() + MAX_START_LEAD_MS &&
      end.getTime() - now.getTime() >= MIN_WINDOW_MS / 2;
    if (!valid) {
      throw new BadRequestException(INVALID_WINDOW);
    }
  }

  private async actorEmail(organizationId: string, actor: AuthenticatedUser): Promise<string> {
    const user = await this.tenantPrisma.runInOrgContext(organizationId, (tx) => tx.user.findFirst({ where: { id: actor.userId, organizationId }, select: { email: true } }));
    return user?.email ?? actor.email;
  }

  /** Odbiorcy = AKTYWNI pracownicy organizacji z wybranego grona; obce/nieistniejące id => INVALID_AUDIENCE. */
  private async resolveRecipients(tx: Prisma.TransactionClient, organizationId: string, audience: AudienceDto): Promise<ResolvedRecipient[]> {
    const include = { department: { select: { name: true } } } as const;
    const map = (users: { id: string; departmentId: string | null; department: { name: string } | null }[]): ResolvedRecipient[] =>
      users.map((user) => ({ id: user.id, departmentId: user.departmentId, departmentName: user.department?.name ?? null }));

    if (audience.type === 'ALL') {
      if (audience.departmentIds?.length || audience.userIds?.length) {
        throw new BadRequestException(INVALID_AUDIENCE);
      }
      return map(await tx.user.findMany({ where: { organizationId, status: 'ACTIVE' }, include, take: CAMPAIGN_LIMITS.maxRecipients + 1 }));
    }
    if (audience.type === 'DEPARTMENTS') {
      const ids = audience.departmentIds ?? [];
      if (ids.length === 0 || audience.userIds?.length) {
        throw new BadRequestException(INVALID_AUDIENCE);
      }
      const found = await tx.department.count({ where: { organizationId, id: { in: ids } } });
      if (found !== ids.length) {
        throw new BadRequestException(INVALID_AUDIENCE);
      }
      return map(await tx.user.findMany({ where: { organizationId, status: 'ACTIVE', departmentId: { in: ids } }, include, take: CAMPAIGN_LIMITS.maxRecipients + 1 }));
    }
    const ids = audience.userIds ?? [];
    if (ids.length === 0 || audience.departmentIds?.length) {
      throw new BadRequestException(INVALID_AUDIENCE);
    }
    const users = await tx.user.findMany({ where: { organizationId, status: 'ACTIVE', id: { in: ids } }, include });
    if (users.length !== ids.length) {
      throw new BadRequestException(INVALID_AUDIENCE);
    }
    return map(users);
  }

  private async statsFor(tx: Prisma.TransactionClient, organizationId: string, campaignIds: string[]) {
    const stats = new Map<string, { counts: CampaignCounts; failures: CampaignView['failures'] }>();
    if (campaignIds.length === 0) {
      return stats;
    }
    const groups = await tx.phishingCampaignRecipient.groupBy({
      by: ['campaignId', 'failureCode'],
      where: { organizationId, campaignId: { in: campaignIds } },
      _count: { _all: true, sentAt: true },
    });
    for (const group of groups) {
      const entry = stats.get(group.campaignId) ?? { counts: { total: 0, pending: 0, sent: 0, failed: 0, uncertain: 0 }, failures: [] };
      const { counts } = entry;
      counts.total += group._count._all;
      counts.sent += group._count.sentAt;
      if (group.failureCode !== null) {
        const uncertain = isUncertainFailureCode(group.failureCode);
        counts[uncertain ? 'uncertain' : 'failed'] += group._count._all;
        entry.failures.push({ code: group.failureCode, count: group._count._all, uncertain });
      }
      stats.set(group.campaignId, entry);
    }
    for (const { counts } of stats.values()) {
      counts.pending = counts.total - counts.sent - counts.failed - counts.uncertain;
    }
    return stats;
  }

  private toView(campaign: PhishingCampaign, stats?: { counts: CampaignCounts; failures: CampaignView['failures'] }): CampaignView {
    const domain = this.phishingConfig.senderDomain();
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      audienceType: campaign.audienceType,
      templateName: campaign.templateName,
      subject: campaign.subject,
      senderName: campaign.senderName,
      senderAddress: domain ? `${campaign.senderLocalPart}@${domain}` : null,
      windowStart: campaign.windowStart,
      windowEnd: campaign.windowEnd,
      createdAt: campaign.createdAt,
      cancelledAt: campaign.cancelledAt,
      completedAt: campaign.completedAt,
      createdByEmail: campaign.createdByEmail,
      counts: stats?.counts ?? { total: 0, pending: 0, sent: 0, failed: 0, uncertain: 0 },
      failures: (stats?.failures ?? []).sort((a, b) => b.count - a.count),
    };
  }
}
