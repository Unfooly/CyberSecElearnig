-- Sesje: refresh tokeny jako HASH w bazie (rotacja, wykrywanie reuse, wylogowanie) i
-- users.sessionsRevokedAt ("wyloguj wszędzie", reset hasła).
--
-- (Wygenerowane przez `prisma migrate dev` linia DROP CONSTRAINT
-- users_organizationId_departmentId_fkey została USUNIĘTA ręcznie - to złożony FK
-- z migracji 20260919130000, którego Prisma nie potrafi wyrazić; patrz README,
-- "Backlog bazy danych".)

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionsRevokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_organizationId_idx" ON "refresh_tokens"("organizationId");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: użytkownik musi należeć do TEJ SAMEJ organizacji (Zasada nr 1; FK omijają RLS).
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- RLS (Zasada nr 1) - fail-closed: brak kontekstu app.current_org_id = zero wierszy.
-- Bypass app.bypass_tenant_rls TYLKO w USING (odczyt): /auth/refresh i /auth/logout muszą
-- odnaleźć token po globalnie unikalnym tokenHash, ZANIM znają organizationId (ten sam
-- powód co reset hasła) - jedyny konsument to TenantPrismaService.runRefreshTokenLookup
-- (sztywny findUnique po tokenHash). WITH CHECK bez bypassu: pod bypassem nie da się
-- zapisać wiersza w cudzej organizacji.
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_refresh_tokens" ON "refresh_tokens"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
  );
