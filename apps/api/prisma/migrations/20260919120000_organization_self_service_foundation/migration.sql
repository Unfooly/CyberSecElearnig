-- Fundament modelu samoobsługowego: stan organizacji (weryfikacja domeny),
-- domeny do weryfikacji DNS TXT, dane do faktury i dowody zgód (regulamin,
-- polityka prywatności). Bez zmiany zachowania aplikacji - guard PENDING,
-- nowa rejestracja i job sprzątania to kolejne etapy.
--
-- Bezpieczna dla istniejących danych: kolumna "status" jest dodawana z
-- DEFAULT 'ACTIVE' (istniejące organizacje zostają ACTIVE, bez weryfikacji
-- domeny).
--
-- UWAGA (okno wdrożenia): DEFAULT zostaje 'ACTIVE' CELOWO. Stary kod
-- rejestracji nie tworzy wiersza organization_domains, więc organizacja
-- utworzona nim po tej migracji ze statusem PENDING utknęłaby bez możliwości
-- weryfikacji. Domyślna wartość zmienia się na PENDING_DOMAIN_VERIFICATION
-- (fail-closed) w migracji nowej rejestracji, razem ze zmianą kodu.

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING_DOMAIN_VERIFICATION', 'ACTIVE');
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY_POLICY');

-- AlterTable organizations
ALTER TABLE "organizations" ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "organizations" ADD COLUMN "selfJoinEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "unverifiedWarningSentAt" TIMESTAMP(3);

CREATE INDEX "organizations_status_createdAt_idx" ON "organizations"("status", "createdAt");

-- CreateTable organization_domains
CREATE TABLE "organization_domains" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_domains_organizationId_domain_key" ON "organization_domains"("organizationId", "domain");
CREATE INDEX "organization_domains_organizationId_idx" ON "organization_domains"("organizationId");
CREATE INDEX "organization_domains_domain_idx" ON "organization_domains"("domain");

-- Unikalność domeny TYLKO wśród zweryfikowanych: kilka organizacji może czekać
-- na tę samą domenę, wygrywa pierwsza, której rekord DNS się zgodził. Baza
-- rozstrzyga wyścig atomowo (constraint działa niezależnie od RLS), więc nie
-- potrzeba pre-checku widzącego inne organizacje ani nie ma TOCTOU.
CREATE UNIQUE INDEX "organization_domains_domain_verified_key"
  ON "organization_domains"("domain")
  WHERE "verifiedAt" IS NOT NULL;

ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable organization_billing_details
CREATE TABLE "organization_billing_details" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" VARCHAR(255) NOT NULL,
    "taxId" VARCHAR(10) NOT NULL,
    "addressLine" VARCHAR(255) NOT NULL,
    "postalCode" VARCHAR(6) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'PL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_billing_details_pkey" PRIMARY KEY ("id"),
    -- Na start tylko PL. Sumę kontrolną NIP sprawdza aplikacja; baza pilnuje
    -- formatu, żeby śmieci nie wpadły przez inną ścieżkę niż API.
    CONSTRAINT "organization_billing_details_country_pl_check" CHECK ("country" = 'PL'),
    CONSTRAINT "organization_billing_details_taxid_format_check" CHECK ("taxId" ~ '^[0-9]{10}$'),
    CONSTRAINT "organization_billing_details_postal_format_check" CHECK ("postalCode" ~ '^[0-9]{2}-[0-9]{3}$'),
    -- Puste (same spacje) nazwa, adres i miasto nie nadają się na fakturę.
    CONSTRAINT "organization_billing_details_nonblank_check" CHECK (
      btrim("legalName") <> '' AND btrim("addressLine") <> '' AND btrim("city") <> ''
    )
);

CREATE UNIQUE INDEX "organization_billing_details_organizationId_key" ON "organization_billing_details"("organizationId");

ALTER TABLE "organization_billing_details" ADD CONSTRAINT "organization_billing_details_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable legal_acceptances
CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_acceptances_userId_documentType_version_key" ON "legal_acceptances"("userId", "documentType", "version");
CREATE INDEX "legal_acceptances_organizationId_idx" ON "legal_acceptances"("organizationId");

ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Złożony klucz obcy (organizationId, userId) -> users(organizationId, id):
-- zgoda może wskazywać wyłącznie użytkownika TEJ SAMEJ organizacji. Sam FK na
-- users(id) pozwoliłby powiązać wiersz organizacji A z użytkownikiem B (i
-- działałby jak wyrocznia istnienia cudzych id - błąd FK vs sukces).
CREATE UNIQUE INDEX "users_organizationId_id_key" ON "users"("organizationId", "id");
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_organizationId_userId_fkey"
  FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Zasada nr 1): fail-closed, FORCE (dotyczy też właściciela tabel).
-- Bez wyjątku app.bypass_tenant_rls: żaden z tych przepływów nie potrzebuje
-- czytać cudzych wierszy (unikalność zweryfikowanej domeny rozstrzyga indeks,
-- nie zapytanie). Sprzątanie niezweryfikowanych organizacji kasuje wiersze
-- organizations (tabela globalna), a dzieci znikają kaskadą FK.
ALTER TABLE "organization_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_organization_domains" ON "organization_domains"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "organization_billing_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_billing_details" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_organization_billing_details" ON "organization_billing_details"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "legal_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_acceptances" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_legal_acceptances" ON "legal_acceptances"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
