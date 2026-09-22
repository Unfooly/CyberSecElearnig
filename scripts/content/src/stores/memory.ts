import { createHash } from 'node:crypto';
import type { ObjectHead, ObjectStore, PutOptions } from '../types.js';
import { assertSafeKey } from './key.js';

export interface StoredObject {
  body: Uint8Array;
  options: PutOptions;
}

/** Magazyn w pamięci do testów potoku (bez dysku i sieci); liczy wywołania, żeby testy mogły pilnować idempotencji ("drugi przebieg: zero zapisów"). */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, StoredObject>();
  readonly calls = { head: 0, get: 0, put: 0 };

  async head(key: string): Promise<ObjectHead | null> {
    assertSafeKey(key);
    this.calls.head += 1;
    const object = this.objects.get(key);
    if (!object) return null;
    return { size: object.body.byteLength, md5: createHash('md5').update(object.body).digest('hex') };
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    this.calls.get += 1;
    return this.objects.get(key)?.body ?? null;
  }

  async put(key: string, body: Uint8Array, options: PutOptions, overwrite = false): Promise<boolean> {
    assertSafeKey(key);
    this.calls.put += 1;
    if (!overwrite && this.objects.has(key)) return false;
    this.objects.set(key, { body, options });
    return true;
  }
}
