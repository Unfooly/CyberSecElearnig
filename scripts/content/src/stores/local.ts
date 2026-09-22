import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ObjectHead, ObjectStore, PutOptions } from '../types.js';
import { assertSafeKey } from './key.js';

/** Limit łącznej wielkości plików audio (mp3) w katalogu lokalnym (dotyczy tylko trybu --storage local: pliki lądują w repo). */
export const DEFAULT_MAX_LOCAL_AUDIO_BYTES = 30 * 1024 * 1024;

export interface LocalStoreOptions {
  /** Limit łącznej wielkości `audio/**.mp3` w katalogu; przekroczenie przy zapisie to błąd (nic nie jest zapisywane). */
  maxAudioBytes?: number;
}

/**
 * Magazyn w katalogu lokalnym (domyślnie apps/web/public/content, serwowany przez Next pod /content). Nagłówki (Content-Type, Cache-Control)
 * ustawia wtedy serwer Next, więc `PutOptions` są tu ignorowane. Zapis bez nadpisania jest atomowy (flaga `wx`), z nadpisaniem: plik
 * tymczasowy + rename (czytelnik nigdy nie widzi pół pliku).
 */
export class LocalStore implements ObjectStore {
  private readonly root: string;
  private readonly maxAudioBytes: number;

  constructor(root: string, options: LocalStoreOptions = {}) {
    this.root = resolve(root);
    this.maxAudioBytes = options.maxAudioBytes ?? DEFAULT_MAX_LOCAL_AUDIO_BYTES;
  }

  /** Ścieżka pliku dla klucza; dodatkowo sprawdzamy, że wynik leży w katalogu głównym (obrona w głąb obok assertSafeKey). */
  private pathFor(key: string): string {
    assertSafeKey(key);
    const target = resolve(this.root, ...key.split('/'));
    if (!target.startsWith(this.root + sep)) throw new Error('Klucz wychodzi poza katalog magazynu.');
    return target;
  }

  async head(key: string): Promise<ObjectHead | null> {
    const bytes = await this.get(key);
    if (!bytes) return null;
    return { size: bytes.byteLength, md5: createHash('md5').update(bytes).digest('hex') };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(key: string, body: Uint8Array, _options: PutOptions, overwrite = false): Promise<boolean> {
    const path = this.pathFor(key);
    if (key.startsWith('audio/') && key.toLowerCase().endsWith('.mp3')) await this.assertAudioCapacity(path, body.byteLength);
    await mkdir(dirname(path), { recursive: true });
    if (!overwrite) {
      try {
        await writeFile(path, body, { flag: 'wx' });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
    }
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, body);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }); // nie zostawiamy plików *.tmp po nieudanym zapisie
      throw error;
    }
    return true;
  }

  /** Łączna wielkość mp3 w audio/ po zapisie (bez pliku, który ewentualnie zastępujemy) nie może przekroczyć limitu. */
  private async assertAudioCapacity(targetPath: string, incomingBytes: number): Promise<void> {
    let total = incomingBytes;
    let replaced = 0;
    try {
      replaced = (await stat(targetPath)).size;
    } catch {
      // nowy plik
    }
    total -= replaced;
    total += await this.audioBytes(join(this.root, 'audio'));
    if (total > this.maxAudioBytes) {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
      throw new Error(`Limit audio w repo (tryb local): ${mb(total)} MB > ${mb(this.maxAudioBytes)} MB. Użyj --storage r2 albo usuń stare nagrania.`);
    }
  }

  private async audioBytes(directory: string): Promise<number> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    let total = 0;
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) total += await this.audioBytes(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp3')) total += (await stat(path)).size;
    }
    return total;
  }
}
