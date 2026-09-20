import { createHash } from 'crypto';

/** SHA-256 (hex) tokenu z linku: w bazie trzymamy wyłącznie ten skrót, nigdy sam token. */
export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
