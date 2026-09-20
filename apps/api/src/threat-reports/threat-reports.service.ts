import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, ThreatReportMatchMethod } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { KeyedMutex } from '../common/keyed-mutex';
import { PhishingConfigService } from '../phishing/phishing-config.service';
import { sha256Hex } from '../phishing/token-hash';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreateThreatReportDto } from './dto/create-threat-report.dto';
import { extractSenderAddress, extractTrackingTokens, maskTrackingTokens, normalizeSubject, sanitizePlainText } from './report-text';

const err = (code: string, message: string) => ({ code, message });
export const REPORT_RATE_LIMIT_HOURLY = err('REPORT_RATE_LIMIT', 'Zgłosiłeś/-aś już wiele wiadomości w ostatniej godzinie. Spróbuj ponownie za jakiś czas.');
export const REPORT_RATE_LIMIT_DAILY = err('REPORT_RATE_LIMIT', 'Osiągnięto dzienny limit zgłoszeń. Spróbuj ponownie jutro.');
export const REPORT_INVALID = err('REPORT_INVALID', 'Podaj nadawcę i temat wiadomości.');

/** Limity zgłoszeń na użytkownika (liczone w bazie - nie zależą od adresu IP ani liczby instancji API). */
export const REPORTS_PER_HOUR = 5;
export const REPORTS_PER_DAY = 20;
/** Symulacje wysłane w tym oknie (dni) są brane pod uwagę przy dopasowaniu po nadawcy i temacie. */
export const MATCH_WINDOW_DAYS = 30;
/** Bezpiecznik: ile ostatnich wierszy odbiorcy zgłaszającego porównujemy w pamięci. */
const MAX_CANDIDATES = 200;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface SubmitResult {
  id: string;
  /** true = wiadomość okazała się naszą symulacją (pracownik dostaje pochwałę, zgłoszenie nie trafia do skrzynki). */
  isSimulation: boolean;
}

interface MatchInput {
  reporterUserId: string;
  senderAddress: string | null;
  normalizedSubject: string;
  tokens: string[];
  senderDomain: string | null;
  now: Date;
}

export interface RecipientMatch {
  recipientId: string;
  method: ThreatReportMatchMethod;
}

/**
 * Zgłaszanie podejrzanych wiadomości przez pracowników.
 *
 * Dopasowanie do naszej symulacji (wyłącznie wśród wierszy odbiorców ZGŁASZAJĄCEGO - cudza symulacja nie zmieni
 * wyniku nikogo innego i nie da się nią sprawdzić, kto dostał jaką kampanię):
 *  1. TOKEN (jednoznaczne): w wklejonym tekście jest link śledzący /t/<token> należący do własnego odbiorcy.
 *  2. SENDER_SUBJECT: dokładny adres nadawcy (część lokalna z kampanii + PHISHING_EMAIL_DOMAIN) ORAZ znormalizowany
 *     temat tej samej kampanii, wysłanej w ostatnich 30 dniach (kampania RUNNING/COMPLETED, wiadomość przyjęta
 *     przez dostawcę). Sam nadawca albo sam temat NIE wystarcza.
 * Możliwe fałszywe dopasowanie (ścieżka 2): prawdziwy phishing podszywający się dokładnie pod nasz adres nadawcy
 * (domena symulacji chroniona SPF/DKIM/DMARC) i temat kampanii, którą zgłaszający faktycznie dostał w ostatnich
 * 30 dniach, zostałby uznany za symulację. Ryzyko jest małe (wymaga sfałszowania naszej domeny i znajomości tematu),
 * a skutek ograniczony: brak wpisu w skrzynce zgłoszeń - dlatego dopasowanie wymaga OBU cech, a nie jednej.
 */
@Injectable()
export class ThreatReportsService {
  private readonly submitLock = new KeyedMutex();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly phishingConfig: PhishingConfigService,
  ) {}

  async submit(user: AuthenticatedUser, dto: CreateThreatReportDto, now: Date = new Date()): Promise<SubmitResult> {
    // Sanityzacja do czystego tekstu, potem maskowanie linków śledzących w KAŻDYM polu (token można wkleić w dowolnym).
    const rawTexts = {
      sender: sanitizePlainText(dto.sender, { multiline: false }),
      subject: sanitizePlainText(dto.subject, { multiline: false }),
      body: dto.body ? sanitizePlainText(dto.body, { multiline: true }) : '',
      headers: dto.headers ? sanitizePlainText(dto.headers, { multiline: true }) : '',
      comment: dto.comment ? sanitizePlainText(dto.comment, { multiline: false }) : '',
    };
    if (!rawTexts.sender || !rawTexts.subject) {
      throw new BadRequestException(REPORT_INVALID);
    }
    // Tokeny wyciągamy PRZED maskowaniem; do bazy trafia wyłącznie tekst po maskowaniu.
    const tokens = extractTrackingTokens(rawTexts.sender, rawTexts.subject, rawTexts.body, rawTexts.headers, rawTexts.comment);
    const masked = {
      sender: maskTrackingTokens(rawTexts.sender).slice(0, 320),
      subject: maskTrackingTokens(rawTexts.subject).slice(0, 300),
      body: maskTrackingTokens(rawTexts.body),
      headers: maskTrackingTokens(rawTexts.headers),
      comment: maskTrackingTokens(rawTexts.comment).slice(0, 1000),
    };

    // Kolejka w procesie (bez zajmowania połączeń z puli) + blokada w bazie (ochrona między instancjami): limity
    // per użytkownik muszą być atomowe wobec równoległych zgłoszeń.
    return this.submitLock.run(user.userId, () =>
      this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`threat-report:${user.userId}`}))`;
        await this.enforceRateLimit(tx, user, now);

        const reporter = await tx.user.findFirst({ where: { id: user.userId, organizationId: user.organizationId }, select: { departmentId: true } });
        const match = await this.findSimulationMatch(tx, user.organizationId, {
          reporterUserId: user.userId,
          senderAddress: extractSenderAddress(rawTexts.sender),
          normalizedSubject: normalizeSubject(rawTexts.subject),
          tokens,
          senderDomain: this.phishingConfig.senderDomain(),
          now,
        });

        // Zgłoszenie symulacyjne NIE zachowuje treści (body, headers, comment): zostaje temat, nadawca i powiązanie z
        // odbiorcą (CHECK w bazie pilnuje tego także przy błędzie w kodzie).
        const report = await tx.threatReport.create({
          data: {
            organizationId: user.organizationId,
            reporterUserId: user.userId,
            reporterDepartmentId: reporter?.departmentId ?? null,
            kind: match ? 'SIMULATION' : 'REAL',
            senderText: masked.sender,
            subject: masked.subject,
            body: match ? null : masked.body || null,
            headers: match ? null : masked.headers || null,
            comment: match ? null : masked.comment || null,
            matchedRecipientId: match?.recipientId ?? null,
            matchMethod: match?.method ?? null,
          },
          select: { id: true },
        });

        if (match) {
          // reportedAt ustawiane RAZ: atomowy warunek IS NULL (drugie zgłoszenie tej samej wiadomości nic nie zmienia).
          await tx.phishingCampaignRecipient.updateMany({
            where: { id: match.recipientId, organizationId: user.organizationId, userId: user.userId, reportedAt: null },
            data: { reportedAt: now },
          });
        }
        return { id: report.id, isSimulation: match !== null };
      }, { maxWait: 15_000, timeout: 30_000 }),
    );
  }

  private async enforceRateLimit(tx: Prisma.TransactionClient, user: AuthenticatedUser, now: Date): Promise<void> {
    const base = { organizationId: user.organizationId, reporterUserId: user.userId };
    const [lastHour, lastDay] = await Promise.all([
      tx.threatReport.count({ where: { ...base, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } } }),
      tx.threatReport.count({ where: { ...base, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    if (lastHour >= REPORTS_PER_HOUR) {
      throw new HttpException(REPORT_RATE_LIMIT_HOURLY, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (lastDay >= REPORTS_PER_DAY) {
      throw new HttpException(REPORT_RATE_LIMIT_DAILY, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Wystawione publicznie dla testów jednostkowych/e2e: szuka odbiorcy symulacji wśród wierszy zgłaszającego. */
  async findSimulationMatch(tx: Prisma.TransactionClient, organizationId: string, input: MatchInput): Promise<RecipientMatch | null> {
    // 1. Token w tekście => jednoznaczne, ale tylko dla WŁASNEGO wiersza odbiorcy (userId zgłaszającego).
    if (input.tokens.length > 0) {
      const own = await tx.phishingCampaignRecipient.findFirst({
        where: { organizationId, userId: input.reporterUserId, tokenHash: { in: input.tokens.map(sha256Hex) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (own) {
        return { recipientId: own.id, method: 'TOKEN' };
      }
    }

    // 2. Dokładny nadawca ORAZ znormalizowany temat. Bez własnej domeny nadawcy symulacji (brak konfiguracji) nie ma
    // czego porównywać. Nadawcy niepodanego jako adres nie zgadujemy.
    if (!input.senderDomain || !input.senderAddress || !input.normalizedSubject) {
      return null;
    }
    const since = new Date(input.now.getTime() - MATCH_WINDOW_DAYS * DAY_MS);
    const candidates = await tx.phishingCampaignRecipient.findMany({
      where: {
        organizationId,
        userId: input.reporterUserId,
        sentAt: { gte: since },
        campaign: { organizationId, status: { in: ['RUNNING', 'COMPLETED'] } },
      },
      orderBy: { sentAt: 'desc' },
      take: MAX_CANDIDATES,
      select: { id: true, campaign: { select: { subject: true, senderLocalPart: true } } },
    });
    const found = candidates.find(
      (candidate) =>
        `${candidate.campaign.senderLocalPart}@${input.senderDomain}`.toLowerCase() === input.senderAddress &&
        normalizeSubject(candidate.campaign.subject) === input.normalizedSubject,
    );
    return found ? { recipientId: found.id, method: 'SENDER_SUBJECT' } : null;
  }
}
