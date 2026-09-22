import { User } from 'lucide-react';
import { AVATAR_PRESETS } from '@/lib/gamification-types';
import { isUploadedAvatar, uploadedAvatarSrc } from '@/lib/avatar';

const SIZE_CLASSES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
} as const;

const ICON_SIZES = { sm: 16, md: 24 } as const;

// Współdzielone między UserGamificationCard, ustawieniami konta, Topbar i
// LeaderboardTable - jeden punkt prawdy o tym, jak rysujemy avatar (preset
// -> ikona Lucide, URL -> <img>, brak -> inicjały albo ikona domyślna),
// żeby te miejsca się nie rozjechały.
export default function AvatarDisplay({
  avatarUrl,
  size = 'md',
  label,
  initials,
  userId,
}: {
  avatarUrl: string | null;
  size?: keyof typeof SIZE_CLASSES;
  label?: string;
  // Fallback, gdy użytkownik nie ustawił avatara (np. w rankingu).
  initials?: string;
  // Czyj to avatar - potrzebne dla wgranego obrazka (`upload:<hash>`). Pominięty = własny ("me").
  userId?: string | null;
}) {
  const PresetIcon = avatarUrl ? AVATAR_PRESETS[avatarUrl] : undefined;
  const baseClasses = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-bold text-accent-ink ${SIZE_CLASSES[size]}`;

  if (PresetIcon) {
    return (
      <span className={baseClasses} role="img" aria-label={label ?? 'Avatar'}>
        <PresetIcon size={ICON_SIZES[size]} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }

  // Własny obrazek wgrany przez użytkownika: adres składamy z identyfikatora i skrótu treści,
  // a plik idzie z NASZEGO origin przez trasę BFF (CSP `img-src 'self' ...`, D-067). Avatary z
  // obcych adresów nie są już obsługiwane (B-075) - taka wartość daje inicjały, jak brak avatara.
  if (isUploadedAvatar(avatarUrl)) {
    return (
      // next/image wymagałby konfiguracji hostów; to własna trasa, więc zwykły <img> wystarcza.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={uploadedAvatarSrc(avatarUrl as string, userId)}
        alt={label ?? 'Avatar'}
        className={baseClasses}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className={baseClasses} role="img" aria-label={label ?? 'Brak avatara'}>
      {initials ? initials : <User size={ICON_SIZES[size]} strokeWidth={2} aria-hidden="true" />}
    </span>
  );
}
