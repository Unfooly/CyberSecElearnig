-- Weryfikacja adresu e-mail (rejestracja): User.emailVerifiedAt + tabela
-- jednorazowych tokenów weryfikacyjnych (hash SHA-256, jak password_reset_tokens).
-- Istniejące konta uznajemy za zweryfikowane (backfill now()) - inaczej po
-- wdrożeniu logowanie zostałoby zablokowane wszystkim dotychczasowym userom.

ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
UPDATE "users" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_organizationId_idx" ON "email_verification_tokens"("organizationId");
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Zasada nr 1): fail-closed; bypass app.bypass_tenant_rls tylko w USING
-- (odczyt) - /auth/verify-email musi znaleźć rekord po tokenHash zanim zna
-- organizationId (TenantPrismaService.runEmailVerificationTokenLookup).
ALTER TABLE "email_verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_verification_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_email_verification_tokens" ON "email_verification_tokens"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
  );
