// Avatar użytkownika: preset (slug z AVATAR_PRESETS) albo własny obrazek wgrany przez
// użytkownika. Własny obrazek jest w bazie trzymany jako znacznik `upload:<hash>` - adres
// składamy tutaj, bo obrazek MUSI iść przez nasz origin (CSP `img-src 'self' ...`, D-053/D-067).

const UPLOADED_PREFIX = 'upload:';

export function isUploadedAvatar(avatarUrl: string | null | undefined): boolean {
  return typeof avatarUrl === 'string' && avatarUrl.startsWith(UPLOADED_PREFIX);
}

/**
 * Adres obrazka avatara. `userId` pomijamy dla własnego avatara ("me" rozwiązuje trasa BFF
 * z tokena). Skrót z znacznika trafia do parametru `v`, żeby po zmianie avatara przeglądarka
 * nie pokazała starego z cache.
 */
export function uploadedAvatarSrc(avatarUrl: string, userId?: string | null): string {
  const hash = avatarUrl.slice(UPLOADED_PREFIX.length);
  const who = userId && userId.length > 0 ? encodeURIComponent(userId) : 'me';
  return `/api/users/${who}/avatar/image${hash ? `?v=${encodeURIComponent(hash)}` : ''}`;
}
