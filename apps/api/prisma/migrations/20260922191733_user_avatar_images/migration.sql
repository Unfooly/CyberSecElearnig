-- Własny avatar wgrany przez użytkownika (D-067, zgłoszenie B-075). Trzymamy WYŁĄCZNIE obraz ponownie zakodowany przez API
-- (256x256, bez metadanych EXIF), nigdy pliku przysłanego przez klienta. Osobna tabela, żeby bajty nie ładowały się przy
-- każdym zapytaniu o użytkownika.
--
-- UWAGA: `prisma migrate dev` wygenerował tu dodatkowo kilkanaście `DROP CONSTRAINT` dla złożonych kluczy obcych
-- ("organizationId", "userId") -> users("organizationId", "id"), których Prisma nie potrafi wyrazić w schemacie. Zostały
-- usunięte z tej migracji celowo (CLAUDE.md: tych kluczy NIE usuwamy przy generowaniu kolejnych migracji).

-- CreateTable
CREATE TABLE "user_avatar_images" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "hash" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_avatar_images_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "user_avatar_images_organizationId_idx" ON "user_avatar_images"("organizationId");

-- AddForeignKey
ALTER TABLE "user_avatar_images" ADD CONSTRAINT "user_avatar_images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_avatar_images" ADD CONSTRAINT "user_avatar_images_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Złożony FK (tylko w SQL, Prisma go nie wyrazi): avatar musi należeć do użytkownika z TEJ SAMEJ organizacji, co wpis.
-- Bez niego zapis z podmienionym organizationId dałby wiersz "widoczny" w cudzej organizacji mimo poprawnego userId.
ALTER TABLE "user_avatar_images" ADD CONSTRAINT "user_avatar_images_organizationId_userId_fkey"
  FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Awatary z zewnętrznych adresów (przed D-067 API przyjmowało dowolny https) NIE dawały się wyświetlić: CSP z D-053
-- dopuszcza obrazki tylko z 'self', data: i domeny treści. Czyścimy je do NULL (użytkownik widzi inicjały i może wybrać
-- preset albo wgrać własny plik) - część kryterium akceptacji B-075. Presety to slugi, więc nie pasują do 'http%'.
UPDATE "users" SET "avatarUrl" = NULL WHERE "avatarUrl" LIKE 'http%';

-- RLS (Zasada nr 1), FORCE, fail-closed; bez żadnego bypassu - obrazek czyta się wyłącznie w kontekście własnej organizacji.
ALTER TABLE "user_avatar_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_avatar_images" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_avatar_images_select" ON "user_avatar_images" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_avatar_images_insert" ON "user_avatar_images" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_avatar_images_update" ON "user_avatar_images" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_avatar_images_delete" ON "user_avatar_images" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));
