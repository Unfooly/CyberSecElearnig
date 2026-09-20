import { BadRequestException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  hasInternalTld,
  isPublicEmailDomain,
  LEGAL_DOCUMENT_VERSION,
  normalizeNip,
  REGISTRATION_COUNTRY,
  Role,
  UserStatus,
} from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailService } from '../email/email.service';
import { emailDomain, generateDomainVerificationToken } from '../organizations/domain.util';
import { AddressClaimService } from '../users/address-claim.service';
import { InvitedAccountChangedError, expireInvitedAccounts } from '../users/invited-accounts';
import { AuthService, BCRYPT_ROUNDS } from './auth.service';
import { CLAIM_TOKEN_TTL_MS } from './claim-ttl';
import { RegisterDto } from './dto/register.dto';
import { RegistrationMailLimiter } from './registration-mail-limiter';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
export const CLAIM_INVALID_MESSAGE = 'Ten link jest nieprawidłowy, wygasł albo został już użyty.';
export const CLAIM_CONFIRMED_MESSAGE = 'Adres potwierdzony. Wysłaliśmy wiadomość z linkiem do ustawienia hasła (ważny 24 godziny).';
/** "<organizationId (uuid)>.<64 znaki hex>" - ścisły format (organizationId trafia do set_config, więc tylko prawdziwy UUID). */
const CLAIM_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/;
const hashClaimToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Górna granica jednocześnie przetwarzanych rejestracji w tle (bcrypt + zapis).
// Ochrona CPU/pamięci przed zalewem z wielu IP (throttler limituje tylko per IP);
// nadmiar dostaje 503 - odpowiedź niezależna od stanu jakiegokolwiek konta.
const MAX_PENDING_REGISTRATIONS = 50;

// JEDYNA odpowiedź na poprawnie sformułowane żądanie rejestracji - identyczna
// niezależnie od tego, czy adres jest nowy, czy konto już istnieje (i czy mail
// wyszedł). Anty-enumeracja: nic w odpowiedzi HTTP nie zdradza stanu konta.
export const REGISTRATION_ACCEPTED_MESSAGE =
  'Jeśli podane dane są poprawne, wysłaliśmy wiadomość z linkiem na podany adres e-mail. Kliknij go, aby potwierdzić adres i ustawić hasło.';

// Jedyny przypadek, w którym UI mówi coś o domenie (ustalenie produktowe):
// komunikat nie ujawnia niczego o kontach, tylko wymaga firmowej domeny.
export const PUBLIC_EMAIL_DOMAIN_MESSAGE =
  'Wymagany jest służbowy adres e-mail w domenie firmowej. Adresy z publicznych skrzynek (np. Gmail, WP, Onet) nie są akceptowane.';
const INVALID_EMAIL_DOMAIN_MESSAGE = 'Podaj poprawny służbowy adres e-mail.';
const OVERLOADED_MESSAGE = 'Serwis jest chwilowo przeciążony. Spróbuj ponownie za chwilę.';

/**
 * Samoobsługowa rejestracja firmy: organizacja (PENDING_DOMAIN_VERIFICATION),
 * administrator, dane do faktury, domena do weryfikacji DNS i dowody zgód - w
 * jednej transakcji w kontekście RLS nowej organizacji. Weryfikacja skrzynki
 * (link 24 h) idzie istniejącą ścieżką AuthService; weryfikacja domeny DNS to
 * osobny etap.
 *
 * Po walidacji żądania (DTO, domena firmowa) CAŁA reszta - hash hasła, sprawdzenie
 * istnienia konta, zapis i mail - dzieje się w tle. Odpowiedź HTTP jest więc
 * wysyłana natychmiast i jej czas nie zależy od stanu konta (brak kanału
 * czasowego enumeracji). Cena: błąd zapisu (np. awaria bazy) nie dociera do
 * klienta, tylko do logu - użytkownik nie dostaje maila i może spróbować ponownie.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly mailLimiter: RegistrationMailLimiter,
    private readonly addressClaims: AddressClaimService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const domain = emailDomain(dto.email);
    if (!domain) {
      throw new BadRequestException({ code: 'INVALID_EMAIL_DOMAIN', message: INVALID_EMAIL_DOMAIN_MESSAGE });
    }
    if (hasInternalTld(domain)) {
      throw new BadRequestException({ code: 'INVALID_EMAIL_DOMAIN', message: INVALID_EMAIL_DOMAIN_MESSAGE });
    }
    if (isPublicEmailDomain(domain)) {
      throw new BadRequestException({ code: 'PUBLIC_EMAIL_DOMAIN', message: PUBLIC_EMAIL_DOMAIN_MESSAGE });
    }
    if (this.background.size >= MAX_PENDING_REGISTRATIONS) {
      throw new ServiceUnavailableException(OVERLOADED_MESSAGE);
    }

    this.runInBackground('rejestracja', () => this.processRegistration(dto, domain));
    return { message: REGISTRATION_ACCEPTED_MESSAGE };
  }

  /** Czeka na zakończenie zaległych zadań w tle (testy, zamykanie aplikacji). */
  async flushBackgroundTasks(): Promise<void> {
    await Promise.allSettled([...this.background]);
  }

  private async processRegistration(dto: RegisterDto, domain: string): Promise<void> {
    const existing = await this.tenantPrisma.runAuthLookup({ email: dto.email });
    // Nieaktywowane zaproszenie do obcej organizacji, która nie ma zweryfikowanej domeny tego adresu, nie blokuje rejestracji
    // (squatting adresów) - ale adres przejmujemy DOPIERO po kliknięciu linku przez rejestrującego (potwierdzenie skrzynki), nie
    // przy samym POST /auth/register: anonim nie może w ten sposób kasować cudzych zaproszeń. Do kliknięcia zaproszenie i
    // rejestracja współistnieją (organizacja PENDING bez admina + wpis z danymi admina); bez kliknięcia w 24 h nic się nie dzieje.
    if (existing && (await this.addressClaims.isClaimableByRegistration(existing))) {
      await this.startRegistrationClaim(dto, domain);
      return;
    }
    if (existing) {
      await this.notifyExistingAccount(existing);
      return;
    }

    // Konto bez hasła klienta (pre-hijacking): losowy, nigdy nieujawniany hash -
    // realne hasło ustawia właściciel skrzynki linkiem z maila (24 h).
    const placeholderHash = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
    const created = await this.createOrganization(dto, domain, placeholderHash);
    if (created) {
      if (await this.mailLimiter.tryAcquire(created.email)) {
        await this.authService.sendRegistrationActivation(created);
      }
      return;
    }

    // Wyścig: równoległa rejestracja tego samego adresu zdążyła pierwsza
    // (unikalny users.email). Dla nas to dokładnie ścieżka "konto istnieje".
    const raced = await this.tenantPrisma.runAuthLookup({ email: dto.email });
    if (!raced) {
      throw new InternalServerErrorException();
    }
    await this.notifyExistingAccount(raced);
  }

  /** Organizacja PENDING z danymi do faktury i domeną do weryfikacji (bez administratora - ten dochodzi osobno). */
  private async createOrganizationRecords(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: RegisterDto,
    domain: string,
    taxId: string,
  ): Promise<void> {
    await tx.organization.create({
      data: { id: organizationId, name: dto.organizationName, status: 'PENDING_DOMAIN_VERIFICATION' },
    });
    await tx.organizationBillingDetails.create({
      data: {
        organizationId,
        legalName: dto.organizationLegalName,
        taxId,
        addressLine: dto.addressLine,
        postalCode: dto.postalCode,
        city: dto.city,
        country: REGISTRATION_COUNTRY,
      },
    });
    await tx.organizationDomain.create({
      data: { organizationId, domain, verificationToken: generateDomainVerificationToken() },
    });
  }

  /**
   * Rejestracja na adres z nieaktywowanym zaproszeniem w obcej organizacji: organizacja (PENDING) i wpis z danymi admina powstają od
   * razu, ale konta admina jeszcze NIE (adres jest zajęty), a mail z linkiem potwierdzającym skrzynkę idzie na ten adres. Dopiero
   * kliknięcie (`claimRegistration`) przejmuje adres i tworzy admina. Odpowiedź rejestracji jest identyczna jak zawsze.
   */
  private async startRegistrationClaim(dto: RegisterDto, domain: string): Promise<void> {
    // Limiter skrzynki PRZED jakimkolwiek zapisem: gdy mail i tak nie wyjdzie (jedna wiadomość na skrzynkę na 10 minut), nic nie
    // powstaje - ani organizacja, ani wpis (nikt nie dostałby tokenu, a seria rejestracji nie zapychałaby bazy).
    if (!(await this.mailLimiter.tryAcquire(dto.email))) {
      return;
    }
    const organizationId = randomUUID();
    const taxId = normalizeNip(dto.taxId) as string;
    const rawToken = `${organizationId}.${randomBytes(32).toString('hex')}`;
    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      await this.createOrganizationRecords(tx, organizationId, dto, domain, taxId);
      await tx.pendingAdminClaim.create({
        data: {
          organizationId,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          legalVersion: LEGAL_DOCUMENT_VERSION,
          tokenHash: hashClaimToken(rawToken),
          expiresAt: new Date(Date.now() + CLAIM_TOKEN_TTL_MS),
        },
      });
    });
    const baseUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    await this.emailService.send({
      to: dto.email,
      subject: 'Potwierdź rejestrację firmy w Unfooly',
      templateName: 'registration-claim',
      templateData: { claimUrl: `${baseUrl}/claim-registration?token=${rawToken}`, organizationName: dto.organizationName },
    });
  }

  /**
   * Klik w link z maila `registration-claim`: potwierdzenie skrzynki rejestrującego. W JEDNEJ transakcji: (1) usunięcie
   * nieaktywowanego zaproszenia w obcej organizacji (pod jej RLS, o ile nadal wolno je przejąć), (2) utworzenie administratora
   * organizacji (INVITED, bez hasła klienta) ze zgodami i (3) zużycie wpisu - albo wszystko, albo nic (niepowodzenie tworzenia
   * admina nie kasuje cudzego zaproszenia). Dopiero PO commicie idzie zwykły link aktywacyjny (ustawienie hasła); jego niepowodzenie
   * niczego nie cofa - admin ma ścieżkę "nie pamiętam hasła". Każda porażka (zły/wygasły/zużyty token, adres aktywowany albo
   * chroniony w międzyczasie) daje TEN SAM błąd.
   */
  async claimRegistration(token: string): Promise<{ message: string }> {
    const fail = () => new BadRequestException({ code: 'CLAIM_INVALID_OR_EXPIRED', message: CLAIM_INVALID_MESSAGE });
    if (!CLAIM_TOKEN_PATTERN.test(token)) {
      throw fail();
    }
    const organizationId = token.split('.')[0];
    const claim = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.pendingAdminClaim.findFirst({ where: { organizationId, tokenHash: hashClaimToken(token), expiresAt: { gt: new Date() } } }),
    );
    if (!claim) {
      throw fail();
    }

    const existing = await this.tenantPrisma.runAuthLookup({ email: claim.email });
    if (existing && !(await this.addressClaims.isClaimableByRegistration(existing))) {
      throw fail();
    }

    const placeholderHash = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
    let created: { id: string; organizationId: string; email: string };
    try {
      created = await this.tenantPrisma.runInOrgContextsSequence(existing?.organizationId ?? organizationId, async (tx, switchOrganization) => {
        if (existing) {
          // Krok 1 pod RLS organizacji-właściciela zaproszenia. Domenę sprawdzamy jeszcze raz (mogła zostać zweryfikowana od
          // sprawdzenia wyżej), a usunięcie jest warunkowe (NEVER_ACTIVATED): konto aktywowane w międzyczasie cofa całą transakcję.
          const domain = emailDomain(existing.email);
          const protectedNow = domain
            ? await tx.organizationDomain.findFirst({ where: { organizationId: existing.organizationId, domain, verifiedAt: { not: null } }, select: { id: true } })
            : null;
          if (protectedNow) {
            throw fail();
          }
          await expireInvitedAccounts(tx, existing.organizationId, [existing.id], new Date());
          await switchOrganization(organizationId);
        }
        // Jednorazowość: wpis usuwamy warunkowo w tej samej transakcji, równoległe kliknięcie dostaje count = 0.
        const consumed = await tx.pendingAdminClaim.deleteMany({ where: { id: claim.id, organizationId, expiresAt: { gt: new Date() } } });
        if (consumed.count !== 1) {
          throw fail();
        }
        const user = await tx.user.create({
          data: {
            organizationId,
            email: claim.email,
            passwordHash: placeholderHash,
            role: Role.ORG_ADMIN,
            status: UserStatus.INVITED,
            firstName: claim.firstName,
            lastName: claim.lastName,
          },
        });
        await tx.legalAcceptance.createMany({
          data: (['TERMS', 'PRIVACY_POLICY'] as const).map((documentType) => ({ organizationId, userId: user.id, documentType, version: claim.legalVersion })),
        });
        return { id: user.id, organizationId, email: user.email };
      });
    } catch (error) {
      if (error instanceof InvitedAccountChangedError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION)) {
        throw fail(); // konto aktywowane albo adres zajęty ponownie (wyścig): transakcja cofnięta, nic się nie zmieniło
      }
      throw error;
    }
    // Po commicie: niepowodzenie wysyłki niczego nie cofa (admin istnieje, hasło ustawi przez "nie pamiętam hasła").
    try {
      await this.authService.sendRegistrationActivation(created);
    } catch (error) {
      this.logger.error(`Potwierdzenie rejestracji: nie udało się wysłać linku aktywacyjnego: ${(error as Error).name}`);
    }
    return { message: CLAIM_CONFIRMED_MESSAGE };
  }

  /**
   * Zwraca utworzonego admina albo null, gdy adres już istnieje (P2002 na
   * users.email). Kolizję łapiemy POZA transakcją i nie zwracamy klientowi
   * nic z błędu Prismy (ani message, ani meta - zawierałyby nazwę constraintu
   * i kolumny); do logu idzie tylko kod.
   */
  private async createOrganization(
    dto: RegisterDto,
    domain: string,
    passwordHash: string,
  ): Promise<{ id: string; organizationId: string; email: string } | null> {
    // Id generujemy przed transakcją, żeby kontekst RLS mógł iść przez jedyny
    // punkt prawdy (TenantPrismaService.runInOrgContext) - organizacja jeszcze
    // nie istnieje, więc nie poznamy jej id inaczej niż wygenerować je z góry.
    const organizationId = randomUUID();
    // DTO zwalidowało NIP (suma kontrolna), więc normalizacja zawsze się uda.
    const taxId = normalizeNip(dto.taxId) as string;

    try {
      return await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
        await this.createOrganizationRecords(tx, organizationId, dto, domain, taxId);
        const user = await tx.user.create({
          data: {
            organizationId,
            email: dto.email,
            passwordHash,
            role: Role.ORG_ADMIN,
            // INVITED = hasło jeszcze nie ustawione; resetPassword (link z maila)
            // przełącza na ACTIVE i ustawia emailVerifiedAt.
            status: UserStatus.INVITED,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
        });
        await tx.legalAcceptance.createMany({
          data: (['TERMS', 'PRIVACY_POLICY'] as const).map((documentType) => ({
            organizationId,
            userId: user.id,
            documentType,
            version: LEGAL_DOCUMENT_VERSION,
          })),
        });
        return { id: user.id, organizationId, email: user.email };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        const target = error.meta?.target;
        const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
        // W transakcji interaktywnej Prisma potrafi zwrócić meta.target = null (bez
        // nazwy constraintu), ale zawsze podaje model. Jedyny unikalny klucz, który
        // może tu zderzyć się przy tworzeniu użytkownika, to users.email (id to
        // losowe cuid, a (organizationId, id) jest z nim spójne).
        const isEmailCollision = error.meta?.modelName === 'User' || /email/i.test(targetText);
        if (isEmailCollision) {
          this.logger.warn('Rejestracja: adres e-mail już istnieje (wyścig) - traktujemy jak istniejące konto.');
          return null;
        }
        // Nieoczekiwana kolizja (inny model): logujemy tylko kod.
        this.logger.error(`Rejestracja: nieoczekiwane naruszenie unikalności (${error.code}).`);
        throw new InternalServerErrorException();
      }
      throw error;
    }
  }

  private async notifyExistingAccount(user: {
    id: string;
    organizationId: string;
    email: string;
    firstName: string | null;
    status: string;
    role: string;
    emailVerifiedAt: Date | null;
  }): Promise<void> {
    if (!(await this.mailLimiter.tryAcquire(user.email))) {
      return;
    }
    if (!user.emailVerifiedAt) {
      // Konto czeka na potwierdzenie - nowy link (weryfikacyjny albo, dla
      // zaproszonego, aktywacyjny) zamiast informacji "konto istnieje".
      await this.authService.sendVerificationOrActivation(user);
      return;
    }
    const baseUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    await this.emailService.send({
      to: user.email,
      subject: 'Ktoś próbował zarejestrować konto na Twój adres e-mail',
      templateName: 'registration-existing-account',
      templateData: { loginUrl: `${baseUrl}/login`, forgotPasswordUrl: `${baseUrl}/forgot-password` },
    });
  }

  private runInBackground(label: string, task: () => Promise<void>): void {
    const promise = task()
      .catch((error: Error) => {
        // Nie ujawniamy klientowi; awaria zapisu/maila nie może zmienić odpowiedzi rejestracji.
        this.logger.error(`Rejestracja: zadanie w tle (${label}) nie powiodło się: ${error.message}`);
      })
      .finally(() => this.background.delete(promise));
    this.background.add(promise);
  }
}
