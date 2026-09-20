-- Uzupełnienie znacznika początku wysyłki dla zaproszeń zajętych PRZED wprowadzeniem `inviteSendingAt` (stary kod zajmował wiersze
-- znacznikiem `inviteClaimedAt`). Bez tego zajęcie starego rodzaju miałoby `inviteSendingAt = NULL`, a warunek domykania
-- przerwanych wysyłek (`inviteSendingAt < próg`) nigdy nie byłby prawdziwy: wiersz wisiałby w SENDING, blokując pojemność organizacji i
-- domknięcie partii. Stare zajęcie liczymy od jego własnego znacznika (a gdy go brak - od chwili migracji).
UPDATE "user_import_rows"
SET "inviteSendingAt" = COALESCE("inviteClaimedAt", now())
WHERE "inviteStatus" = 'SENDING' AND "inviteSendingAt" IS NULL;
