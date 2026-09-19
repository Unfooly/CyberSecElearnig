-- Szablony symulacji phishingowych + audyt ich zmian.
--
-- (Wygenerowana przez `prisma migrate dev` linia DROP CONSTRAINT
-- users_organizationId_departmentId_fkey została USUNIĘTA ręcznie - to złożony FK
-- z migracji 20260919130000, którego Prisma nie potrafi wyrazić; patrz README,
-- "Backlog bazy danych".)

-- CreateEnum
CREATE TYPE "PhishingTemplateAction" AS ENUM ('CLONED', 'UPDATED', 'DELETED');

-- CreateTable
CREATE TABLE "phishing_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "key" TEXT,
    "name" VARCHAR(120) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "lessonHtml" TEXT NOT NULL,
    "senderName" VARCHAR(80) NOT NULL,
    "senderLocalPart" VARCHAR(64) NOT NULL,
    "sourceTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phishing_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phishing_template_edits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" VARCHAR(120) NOT NULL,
    "action" "PhishingTemplateAction" NOT NULL,
    "changedFields" TEXT[],
    "actorUserId" TEXT,
    "actorEmail" VARCHAR(254) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phishing_template_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phishing_templates_key_key" ON "phishing_templates"("key");

-- CreateIndex
CREATE INDEX "phishing_templates_organizationId_idx" ON "phishing_templates"("organizationId");

-- CreateIndex (cel złożonego FK z phishing_template_edits)
CREATE UNIQUE INDEX "phishing_templates_organizationId_id_key" ON "phishing_templates"("organizationId", "id");

-- CreateIndex
CREATE INDEX "phishing_template_edits_organizationId_templateId_idx" ON "phishing_template_edits"("organizationId", "templateId");

-- AddForeignKey
ALTER TABLE "phishing_templates" ADD CONSTRAINT "phishing_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phishing_template_edits" ADD CONSTRAINT "phishing_template_edits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only (Prisma nie wyraża złożonych FK z opcjonalną kolumną i ON DELETE SET NULL (kolumna),
-- składnia PostgreSQL 15+): wiersze audytu przeżywają usunięcie szablonu i pracownika, a FK dalej
-- pilnuje, że szablon/aktor należą do TEJ SAMEJ organizacji (FK omijają RLS - Zasada nr 1).
-- `prisma migrate dev` pokaże je jako "do usunięcia" - przy generowaniu kolejnych migracji usuń te linie.
ALTER TABLE "phishing_template_edits"
  ADD CONSTRAINT "phishing_template_edits_organizationId_templateId_fkey"
  FOREIGN KEY ("organizationId", "templateId") REFERENCES "phishing_templates"("organizationId", "id")
  ON DELETE SET NULL ("templateId") ON UPDATE NO ACTION;

ALTER TABLE "phishing_template_edits"
  ADD CONSTRAINT "phishing_template_edits_organizationId_actorUserId_fkey"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id")
  ON DELETE SET NULL ("actorUserId") ON UPDATE NO ACTION;

-- Spójność: szablon globalny ma klucz i nie ma organizacji; szablon organizacji odwrotnie.
ALTER TABLE "phishing_templates" ADD CONSTRAINT "phishing_templates_global_or_org_check" CHECK (
  ("organizationId" IS NULL AND "key" IS NOT NULL) OR ("organizationId" IS NOT NULL AND "key" IS NULL)
);

-- Część lokalna adresu nadawcy: małe litery, cyfry, . _ - ; bez podwójnych kropek, początek i koniec alfanumeryczne.
ALTER TABLE "phishing_templates" ADD CONSTRAINT "phishing_templates_local_part_check" CHECK (
  "senderLocalPart" ~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$' AND "senderLocalPart" !~ '\.\.'
);

-- Nagłówek maila: bez znaków sterujących (wstrzyknięcie nagłówków).
ALTER TABLE "phishing_templates" ADD CONSTRAINT "phishing_templates_no_control_chars_check" CHECK (
  "subject" !~ '[[:cntrl:]]' AND "senderName" !~ '[[:cntrl:]]' AND "name" !~ '[[:cntrl:]]'
);

-- RLS (Zasada nr 1), fail-closed. PHISHING_TEMPLATES - polityki OSOBNO NA KOMENDĘ:
--   SELECT: szablony globalne (organizationId IS NULL) ORAZ własne organizacji,
--   INSERT/UPDATE/DELETE: WYŁĄCZNIE własne organizacji. DELETE i UPDATE sprawdzają USING, więc
--   USING tych komend NIE zawiera "IS NULL" - rola aplikacji nie zmieni ani nie usunie szablonu
--   globalnego w kontekście żadnej organizacji. Bez kontekstu organizacji widać tylko globalne.
ALTER TABLE "phishing_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phishing_templates" FORCE ROW LEVEL SECURITY;

CREATE POLICY "phishing_templates_select" ON "phishing_templates" FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = current_setting('app.current_org_id', true));

CREATE POLICY "phishing_templates_insert" ON "phishing_templates" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

CREATE POLICY "phishing_templates_update" ON "phishing_templates" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

CREATE POLICY "phishing_templates_delete" ON "phishing_templates" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- PHISHING_TEMPLATE_EDITS: zwykła izolacja (USING = WITH CHECK), bez bypassu.
ALTER TABLE "phishing_template_edits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phishing_template_edits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_phishing_template_edits" ON "phishing_template_edits"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- Audyt jest APPEND-ONLY dla roli aplikacji: nie ma ona UPDATE ani DELETE na tej tabeli (RLS pilnuje
-- organizacji, ale nie chroniłoby przed skasowaniem własnych wpisów przez przejęte API). Zerowanie
-- templateId/actorUserId oraz kaskada z organizacji robią akcje FK (wykonywane z uprawnieniami właściciela).
REVOKE UPDATE, DELETE ON TABLE "phishing_template_edits" FROM "cyberszkolo_app";

-- SZABLONY GLOBALNE (startowy zestaw 6, PL). Wstawiane tu, jako właściciel schematu - rola aplikacji
-- nie ma prawa ich tworzyć ani zmieniać (patrz polityki wyżej). Zmiana treści = nowa migracja (UPDATE po key).
-- Bez prawdziwych marek. Jedyny link to {{trackingLink}}. Test e2e (phishing-templates.e2e-spec.ts) sprawdza, że
-- sanitizer zostawia treść tych szablonów bez zmian, a klonowanie i tak sanityzuje kopię.
INSERT INTO "phishing_templates" ("id", "organizationId", "key", "name", "subject", "senderName", "senderLocalPart", "bodyHtml", "lessonHtml", "updatedAt") VALUES
('phishtpl_kurier', NULL, 'kurier',
 'Przesyłka kurierska - niedoręczona paczka',
 'Nie udało się doręczyć Twojej przesyłki - potwierdź adres',
 'Szybka Paczka', 'powiadomienia',
 $tpl$<p>Dzień dobry,</p>
<p>Próbowaliśmy doręczyć Twoją paczkę (nr <strong>PL48211937</strong>), ale nikogo nie zastaliśmy. Aby uniknąć zwrotu przesyłki do nadawcy, potwierdź adres dostawy w ciągu 24 godzin.</p>
<p><a href="{{trackingLink}}">Potwierdź adres dostawy</a></p>
<p>Zespół obsługi klienta</p>$tpl$,
 $tpl$<p>Ta wiadomość udawała powiadomienie od firmy kurierskiej. Na co zwrócić uwagę:</p>
<ul>
<li>Nie czekałeś(-aś) na paczkę, a wiadomość wywiera presję czasu („w ciągu 24 godzin”).</li>
<li>Nadawca i numer przesyłki były Ci nieznane - prawdziwy kurier nie prosi o „potwierdzenie adresu” przez link z maila.</li>
<li>Bezpieczniej wejść na stronę kuriera samodzielnie (wpisując adres lub z zakładki) i sprawdzić numer przesyłki.</li>
</ul>
<p>Podejrzaną wiadomość zgłoś działowi bezpieczeństwa, zamiast klikać w link.</p>$tpl$,
 CURRENT_TIMESTAMP),
('phishtpl_faktura', NULL, 'faktura',
 'Faktura do zapłaty - przeterminowana',
 'Przeterminowana faktura FV/2027/0412 - prosimy o pilną płatność',
 'Dział Rozliczeń', 'rozliczenia',
 $tpl$<p>Dzień dobry,</p>
<p>Według naszych danych faktura <strong>FV/2027/0412</strong> na kwotę 4 890,00 zł nie została opłacona w terminie. Szczegóły dokumentu i dane do płatności znajdziesz w załączonym linku.</p>
<p><a href="{{trackingLink}}">Pobierz fakturę</a></p>
<p>Jeśli płatność została już zrealizowana, prosimy o zignorowanie tej wiadomości.</p>$tpl$,
 $tpl$<p>Ta wiadomość udawała przypomnienie o zaległej fakturze. Na co zwrócić uwagę:</p>
<ul>
<li>Faktura, której się nie spodziewasz, od nieznanego kontrahenta i z linkiem zamiast załącznika w znanym systemie.</li>
<li>Ogólne zwroty („Dzień dobry”) i presja płatności - typowe dla oszustw na fakturę.</li>
<li>Przed kliknięciem sprawdź w systemie księgowym, czy taka faktura istnieje, albo zapytaj dział finansów innym kanałem.</li>
</ul>$tpl$,
 CURRENT_TIMESTAMP),
('phishtpl_reset_hasla', NULL, 'reset-hasla',
 'Reset hasła do poczty firmowej',
 'Twoje hasło do poczty wygasa dzisiaj - zaloguj się, aby je zachować',
 'Poczta firmowa', 'centrum-konta',
 $tpl$<p>Twoje hasło do poczty firmowej wygasa dzisiaj o godzinie 17:00.</p>
<p>Aby zachować dostęp do skrzynki i kalendarza, zaloguj się i potwierdź swoje dane.</p>
<p><a href="{{trackingLink}}">Zachowaj hasło i zaloguj się</a></p>
<p>Jeśli nie wykonasz tej czynności, konto zostanie tymczasowo zablokowane.</p>$tpl$,
 $tpl$<p>Ta wiadomość udawała komunikat o wygasającym haśle. Na co zwrócić uwagę:</p>
<ul>
<li>Groźba blokady i termin „dzisiaj” - klasyczna presja czasu.</li>
<li>Adres nadawcy nie należał do Twojego działu IT, a link prowadził poza znane Ci systemy.</li>
<li>Zmianę hasła wykonuj zawsze z zakładki lub przez portal wskazany przez dział IT, nigdy z linku w wiadomości. Nigdy nie podawaj hasła na stronie, do której trafiłeś(-aś) z maila.</li>
</ul>$tpl$,
 CURRENT_TIMESTAMP),
('phishtpl_hr_urlopy', NULL, 'hr-urlopy',
 'HR - zmiany w planie urlopów',
 'Aktualizacja planu urlopów - wymagane potwierdzenie',
 'Dział HR', 'hr',
 $tpl$<p>Cześć,</p>
<p>W związku ze zmianami w organizacji pracy przygotowaliśmy zaktualizowany plan urlopów na nadchodzący kwartał. Każdy pracownik musi potwierdzić swój termin do końca tygodnia, inaczej urlop może zostać przesunięty.</p>
<p><a href="{{trackingLink}}">Sprawdź i potwierdź swój termin urlopu</a></p>
<p>Dziękujemy,<br>Dział HR</p>$tpl$,
 $tpl$<p>Ta wiadomość udawała komunikat z działu HR. Na co zwrócić uwagę:</p>
<ul>
<li>Dotyczy Cię osobiście (urlop) i grozi konsekwencją, jeśli nie zareagujesz - to sposób na skłonienie do szybkiego kliknięcia.</li>
<li>Prawdziwe zmiany w planach urlopów są zwykle komunikowane w znanym systemie kadrowym lub przez przełożonego.</li>
<li>W razie wątpliwości zapytaj dział HR innym kanałem (telefon, komunikator firmowy).</li>
</ul>$tpl$,
 CURRENT_TIMESTAMP),
('phishtpl_it_aktualizacja', NULL, 'it-aktualizacja',
 'IT - pilna aktualizacja zabezpieczeń',
 'Pilna aktualizacja zabezpieczeń Twojego komputera',
 'Dział IT', 'it-support',
 $tpl$<p>Wykryliśmy, że Twój komputer nie ma zainstalowanej najnowszej aktualizacji zabezpieczeń. Do czasu jej zainstalowania nie możemy zagwarantować bezpieczeństwa Twoich danych.</p>
<p>Prosimy o uruchomienie aktualizacji dzisiaj:</p>
<p><a href="{{trackingLink}}">Zainstaluj aktualizację zabezpieczeń</a></p>
<p>Dział IT</p>$tpl$,
 $tpl$<p>Ta wiadomość udawała komunikat od działu IT. Na co zwrócić uwagę:</p>
<ul>
<li>Dział IT zwykle instaluje aktualizacje centralnie i nie prosi o pobieranie ich z linku w mailu.</li>
<li>Wiadomość straszy konsekwencjami i ponagla („dzisiaj”).</li>
<li>Jeśli masz wątpliwości, skontaktuj się z helpdeskiem znanym Ci kanałem (nie odpowiadaj na tego maila) i zgłoś wiadomość.</li>
</ul>$tpl$,
 CURRENT_TIMESTAMP),
('phishtpl_dyrektor_przelew', NULL, 'dyrektor-przelew',
 'Dyrektor prosi o pilny przelew',
 'Pilne - potrzebuję Twojej pomocy w sprawie przelewu',
 'Prezes', 'prezes',
 $tpl$<p>Cześć,</p>
<p>Jestem teraz na spotkaniu z zarządem klienta i nie mogę rozmawiać. Potrzebuję, żebyś dzisiaj pilnie zrealizował(a) przelew dla nowego dostawcy. To poufne - proszę, nie informuj nikogo, dopóki się nie odezwę.</p>
<p><a href="{{trackingLink}}">Dane do przelewu</a></p>
<p>Dzięki, liczę na Ciebie.</p>$tpl$,
 $tpl$<p>Ta wiadomość udawała prośbę przełożonego o pilny, poufny przelew (tzw. oszustwo na prezesa / BEC). Na co zwrócić uwagę:</p>
<ul>
<li>Pilność, poufność i brak możliwości weryfikacji („jestem na spotkaniu”) - to dokładnie schemat oszustwa.</li>
<li>Przelewy dla nowych odbiorców wymagają potwierdzenia innym kanałem i zgodnie z procedurą, niezależnie od tego, kto o nie prosi.</li>
<li>Zadzwoń do osoby, od której rzekomo pochodzi prośba (numer, który znasz), zanim cokolwiek zrobisz, i zgłoś wiadomość.</li>
</ul>$tpl$,
 CURRENT_TIMESTAMP);
