import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import sharp from 'sharp';

/**
 * Własny avatar wgrany przez użytkownika (D-067, zgłoszenie B-075).
 *
 * Zasada: do bazy trafia WYŁĄCZNIE obraz zakodowany tutaj od nowa, nigdy bajty przysłane
 * przez klienta. Ponowne zakodowanie odcina metadane EXIF (w tym współrzędne GPS ze zdjęcia
 * z telefonu), pliki-hybrydy (obraz + doklejony kod), nietypowe warianty formatów i dowolne
 * wymiary. SVG jest odrzucany zawsze - to dokument, który potrafi wykonać skrypt.
 */

/** Limit tego, co w ogóle przyjmujemy od klienta (Multer odrzuca większe PRZED wczytaniem do pamięci). */
export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Bok kwadratu zapisywanego obrazka. 256 px wystarcza na największy avatar w UI (96 px) na ekranach 2x. */
export const AVATAR_IMAGE_SIZE = 256;

/** Format zapisu: WebP jest wyraźnie mniejszy od PNG przy tej samej jakości i obsługiwany przez wszystkie wspierane przeglądarki. */
export const AVATAR_IMAGE_MIME = 'image/webp';

/**
 * Bezpiecznik na "bombę dekompresyjną": plik 2 MB może rozpakować się do gigapiksela.
 * 50 Mpx to znacznie więcej niż jakiekolwiek zdjęcie z telefonu, a mieści się w pamięci.
 */
const MAX_INPUT_PIXELS = 50_000_000;

const ACCEPTED_MESSAGE = 'Dozwolone są pliki PNG, JPEG lub WebP o rozmiarze do 2 MB.';

/** Rozpoznanie formatu po pierwszych bajtach - nie po nagłówku Content-Type ani rozszerzeniu, bo oba podaje klient. */
function sniffFormat(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export interface ProcessedAvatarImage {
  bytes: Buffer;
  mimeType: string;
  /** Skrót treści (8 hex) do `users.avatarUrl` i adresu obrazka - unieważnia cache przeglądarki po zmianie. */
  hash: string;
}

/**
 * Sprawdza i przetwarza wgrany plik. Rzuca BadRequestException z jednym, ogólnym komunikatem -
 * szczegóły (nieobsługiwany format, uszkodzony plik) nic użytkownikowi nie dają, a mówią coś
 * o środowisku serwera.
 */
export async function processAvatarUpload(file: { buffer: Buffer; size: number } | undefined): Promise<ProcessedAvatarImage> {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException('Nie przesłano pliku.');
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    // Multer odrzuca to wcześniej; tu dla pewności, gdyby limit interceptora kiedyś zniknął.
    throw new BadRequestException(ACCEPTED_MESSAGE);
  }
  if (!sniffFormat(file.buffer)) {
    throw new BadRequestException(ACCEPTED_MESSAGE);
  }

  let bytes: Buffer;
  try {
    bytes = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      // Kwadrat z wykadrowaniem środka: wszystkie avatary w UI są okrągłe, więc inne proporcje i tak byłyby przycięte.
      .resize(AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Uszkodzony plik, nieobsługiwany wariant formatu, przekroczony limit pikseli.
    throw new BadRequestException(ACCEPTED_MESSAGE);
  }

  return {
    bytes,
    mimeType: AVATAR_IMAGE_MIME,
    hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  };
}

/** Znacznik zapisywany w `users.avatarUrl` dla wgranego avatara (zamiast adresu - ten składa API). */
export const UPLOADED_AVATAR_PREFIX = 'upload:';

export function uploadedAvatarValue(hash: string): string {
  return `${UPLOADED_AVATAR_PREFIX}${hash}`;
}

export function isUploadedAvatar(avatarUrl: string | null): boolean {
  return typeof avatarUrl === 'string' && avatarUrl.startsWith(UPLOADED_AVATAR_PREFIX);
}
