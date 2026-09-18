import { User } from 'lucide-react';
import { AVATAR_PRESETS } from '@/lib/gamification-types';

const SIZE_CLASSES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
} as const;

const ICON_SIZES = { sm: 16, md: 24 } as const;

// Współdzielone między UserGamificationCard, AvatarPickerModal, Topbar i
// LeaderboardTable - jeden punkt prawdy o tym, jak rysujemy avatar (preset
// -> ikona Lucide, URL -> <img>, brak -> inicjały albo ikona domyślna),
// żeby te miejsca się nie rozjechały.
export default function AvatarDisplay({
  avatarUrl,
  size = 'md',
  label,
  initials,
}: {
  avatarUrl: string | null;
  size?: keyof typeof SIZE_CLASSES;
  label?: string;
  // Fallback, gdy użytkownik nie ustawił avatara (np. w rankingu).
  initials?: string;
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

  if (avatarUrl) {
    // URL dowolnej domeny (użytkownik wkleja własny link) - next/image
    // wymagałby skonfigurowania dozwolonych hostów z góry.
    return (
      // referrerPolicy: adres strony (z tokenami w query na /verify-email itp.) nie
      // może wyciec do serwera, z którego user wskazał obrazek.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={label ?? 'Avatar'} className={baseClasses} referrerPolicy="no-referrer" />
    );
  }

  return (
    <span className={baseClasses} role="img" aria-label={label ?? 'Brak avatara'}>
      {initials ? initials : <User size={ICON_SIZES[size]} strokeWidth={2} aria-hidden="true" />}
    </span>
  );
}
