import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { sanitizeLessonHtml } from '../template-sanitizer';
import { sha256Hex } from '../token-hash';

/** Token z linku: 32 losowe bajty w base64url (patrz CampaignSenderService) = dokładnie 43 znaki. */
export const TRACKING_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
/** Token przestaje działać po tylu dniach od zajęcia (wysyłki): stare maile nie zmieniają już wyników. */
export const TRACKING_TOKEN_TTL_MS = 90 * 24 * 3_600_000;
/** Kurs przypisywany po kliknięciu: termin ukończenia. */
export const FOLLOW_UP_COURSE_DUE_MS = 14 * 24 * 3_600_000;

/** Lekcja domyślna: dla nieznanego/nieważnego tokenu (odpowiedź neutralna) oraz gdy kampania nie ma poprawnej treści. */
export const DEFAULT_LESSON_HTML =
  '<h2>To była symulacja</h2><p>Ta wiadomość została wysłana w ramach ćwiczenia z rozpoznawania phishingu. ' +
  'Nic złego się nie stało - żadne dane nie zostały zapisane.</p>' +
  '<p>Zanim klikniesz link albo wpiszesz dane, sprawdź nadawcę, adres strony i to, czy wiadomość wywiera presję czasu. ' +
  'W razie wątpliwości zgłoś wiadomość zespołowi bezpieczeństwa.</p>';

/** JEDYNA odpowiedź publicznych endpointów śledzenia: treść lekcji, bez żadnych danych o osobie, kampanii ani organizacji. */
export interface TrackingResponse {
  lessonHtml: string;
}

type TrackingKind = 'view' | 'submit';

/**
 * Publiczne śledzenie symulacji (bez logowania). Odwiedzający zna tylko token z linku.
 *
 * - Liczymy WYŁĄCZNIE wywołania POST z JS strony lądowania (skanery linków w skrzynkach pobierają stronę, nie
 *   wykonują naszych POST-ów); samo pobranie strony (GET /t/<token> w web) niczego nie zapisuje.
 * - Token odnajdujemy po SHA-256 (runTrackingTokenLookup, wąski wyjątek od Zasady nr 1); wszystkie zapisy idą już przez
 *   runInOrgContext(organizationId z wiersza odbiorcy) z jawnym warunkiem organizacji.
 * - Odpowiedź jest NEUTRALNA i tego samego kształtu dla tokenu poprawnego, nieznanego, źle sformatowanego i wygasłego
 *   (zawsze 200 + { lessonHtml }): brak sygnału "ten token istnieje". Przy 256 bitach entropii i limicie żądań
 *   zgadywanie tokenów jest nierealne; różnica czasu odpowiedzi (zapis w bazie) nie daje przewagi.
 * - Wartości z formularza NIE są odczytywane, zapisywane ani logowane (kontroler nie deklaruje @Body); serwis nic nie loguje.
 * - Zapis jest idempotentny: pierwsze wejście ustawia clickedAt, pierwsze wysłanie formularza submittedAt (i clickedAt,
 *   jeśli go brakuje); powtórzenia niczego nie zmieniają. Kurs uzupełniający przypisujemy raz (unikat userId+courseId).
 */
@Injectable()
export class TrackingService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  view(rawToken: string, now: Date = new Date()): Promise<TrackingResponse> {
    return this.record(rawToken, 'view', now);
  }

  submit(rawToken: string, now: Date = new Date()): Promise<TrackingResponse> {
    return this.record(rawToken, 'submit', now);
  }

  private async record(rawToken: string, kind: TrackingKind, now: Date): Promise<TrackingResponse> {
    if (typeof rawToken !== 'string' || !TRACKING_TOKEN_REGEX.test(rawToken)) {
      return { lessonHtml: DEFAULT_LESSON_HTML };
    }
    const tokenHash = sha256Hex(rawToken);
    const ref = await this.tenantPrisma.runTrackingTokenLookup(tokenHash);
    if (!ref?.claimedAt || now.getTime() - ref.claimedAt.getTime() > TRACKING_TOKEN_TTL_MS) {
      return { lessonHtml: DEFAULT_LESSON_HTML };
    }

    const lessonHtml = await this.tenantPrisma.runInOrgContext(ref.organizationId, async (tx) => {
      // Pierwsze wejście (submit też je zalicza: formularz da się wysłać bez wcześniejszego view, np. przy blokadzie JS view).
      await tx.phishingCampaignRecipient.updateMany({
        where: { id: ref.id, organizationId: ref.organizationId, tokenHash, clickedAt: null },
        data: { clickedAt: now },
      });
      if (kind === 'submit') {
        await tx.phishingCampaignRecipient.updateMany({
          where: { id: ref.id, organizationId: ref.organizationId, tokenHash, submittedAt: null },
          data: { submittedAt: now },
        });
      }
      if (ref.userId) {
        await this.assignFollowUpCourse(tx, ref.organizationId, ref.userId, now);
      }
      const campaign = await tx.phishingCampaign.findFirst({ where: { id: ref.campaignId, organizationId: ref.organizationId }, select: { lessonHtml: true } });
      return campaign?.lessonHtml ?? null;
    });

    // Treść lekcji pochodzi ze snapshotu (już sanityzowana przy zapisie szablonu); sanityzujemy ponownie na wyjściu.
    const clean = lessonHtml ? sanitizeLessonHtml(lessonHtml) : '';
    return { lessonHtml: clean || DEFAULT_LESSON_HTML };
  }

  /**
   * Przypisuje pracownikowi kurs z kategorii PHISHING_SOCIAL_ENGINEERING (najstarszy). Idempotentne (unikat
   * userId+courseId, `skipDuplicates`). Pracownik MUSI należeć do podanej organizacji (jawne zapytanie z organizationId;
   * dodatkowo złożone FK w bazie), inaczej nic się nie dzieje. Brak takiego kursu w katalogu = brak przypisania.
   */
  async assignFollowUpCourse(
    tx: Parameters<Parameters<TenantPrismaService['runInOrgContext']>[1]>[0],
    organizationId: string,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const user = await tx.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!user) {
      return false;
    }
    const course = await tx.course.findFirst({
      where: { category: 'PHISHING_SOCIAL_ENGINEERING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, mandatory: true },
    });
    if (!course) {
      return false;
    }
    const created = await tx.courseAssignment.createMany({
      data: [
        {
          organizationId,
          userId: user.id,
          courseId: course.id,
          // Zachowuje dotychczasowe zachowanie (mandatory było liczone z course.mandatory w locie) - teraz jawnie na
          // przypisaniu (D-065).
          mandatory: course.mandatory,
          dueDate: new Date(now.getTime() + FOLLOW_UP_COURSE_DUE_MS),
        },
      ],
      skipDuplicates: true,
    });
    return created.count > 0;
  }
}
