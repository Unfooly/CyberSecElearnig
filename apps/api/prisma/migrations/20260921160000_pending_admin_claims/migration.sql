-- Rejestracja na adres z nieaktywowanym zaproszeniem w obcej organizacji: przejęcie adresu dopiero po KLIKNIĘCIU linku przez
-- rejestrującego. Do tego czasu organizacja (PENDING) istnieje bez administratora, a dane admina czekają w tej tabeli.

-- CreateTable
CREATE TABLE "pending_admin_claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "legalVersion" VARCHAR(64) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_admin_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_admin_claims_tokenHash_key" ON "pending_admin_claims"("tokenHash");

-- CreateIndex
CREATE INDEX "pending_admin_claims_organizationId_idx" ON "pending_admin_claims"("organizationId");

-- AddForeignKey
ALTER TABLE "pending_admin_claims" ADD CONSTRAINT "pending_admin_claims_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Token niesie organizationId ("<organizationId>.<hex>"), więc wpis jest
-- odnajdywany w kontekście własnej organizacji - bez żadnej furtki omijającej RLS.
ALTER TABLE "pending_admin_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_admin_claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pending_admin_claims_select" ON "pending_admin_claims" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "pending_admin_claims_insert" ON "pending_admin_claims" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "pending_admin_claims_delete" ON "pending_admin_claims" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));
