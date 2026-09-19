import { BadRequestException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { isPublicEmailDomain, LEGAL_DOCUMENT_VERSION, normalizeNip, REGISTRATION_COUNTRY, Role } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailService } from '../email/email.service';
import { emailDomain, generateDomainVerificationToken } from '../organizations/domain.util';
import { AuthService, BCRYPT_ROUNDS } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RegistrationMailLimiter } from './registration-mail-limiter';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Górna granica jednocześnie przetwarzanych rejestracji w tle (bcrypt + zapis).
// Ochrona CPU/pamięci przed zalewem z wielu IP (throttler limituje tylko per IP);
// nadmiar dostaje 503 - odpowiedź niezależna od stanu jakiegokolwiek konta.
const MAX_PENDING_REGISTRATIONS = 50;

// JEDYNA odpowiedź na poprawnie sformułowane żądanie rejestracji - identyczna
// niezależnie od tego, czy adres jest nowy, czy konto już istnieje (i czy mail
// wyszedł). Anty-enumeracja: nic w odpowiedzi HTTP nie zdradza stanu konta.
export const REGISTRATION_ACCEPTED_MESSAGE =
  'Jeśli podane dane są poprawne, wysłaliśmy wiadomość z linkiem weryfikacyjnym na podany adres e-mail. Potwierdź go, aby się zalogować.';

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
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const domain = emailDomain(dto.email);
    if (!domain) {
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
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const existing = await this.tenantPrisma.runAuthLookup({ email: dto.email });
    if (existing) {
      await this.notifyExistingAccount(existing);
      return;
    }

    const created = await this.createOrganization(dto, domain, passwordHash);
    if (created) {
      if (this.mailLimiter.tryAcquire(created.email)) {
        await this.authService.sendVerificationEmail(created.organizationId, created.id, created.email);
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
        await tx.organization.create({
          data: { id: organizationId, name: dto.organizationName, status: 'PENDING_DOMAIN_VERIFICATION' },
        });
        const user = await tx.user.create({
          data: {
            organizationId,
            email: dto.email,
            passwordHash,
            role: Role.ORG_ADMIN,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
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
    emailVerifiedAt: Date | null;
  }): Promise<void> {
    if (!this.mailLimiter.tryAcquire(user.email)) {
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
