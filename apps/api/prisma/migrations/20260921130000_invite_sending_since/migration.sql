-- Kolejka zaproszeń z importu: osobny znacznik POCZĄTKU wysyłki danego zaproszenia (zajęcie tuż przed wysyłką), rozdzielony od
-- rezerwacji pojemności biegu (`inviteClaimedAt`). Wiek zajęcia liczymy od chwili wysyłki TEGO zaproszenia, nie od początku biegu.

-- AlterTable
ALTER TABLE "user_import_rows" ADD COLUMN     "inviteSendingAt" TIMESTAMP(3);
