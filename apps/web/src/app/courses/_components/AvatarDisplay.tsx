import { AVATAR_PRESETS } from '@/lib/gamification-types';

const SIZE_CLASSES = {
  sm: 'h-8 w-8 text-base',
  md: 'h-12 w-12 text-2xl',
} as const;

// Współdzielone między UserGamificationCard, AvatarPickerModal i
// LeaderboardTable - jeden punkt prawdy o tym, jak rysujemy avatar (preset
// -> emoji, URL -> <img>, brak -> ikona domyślna), żeby te trzy miejsca się
// nie rozjechały.
export default function AvatarDisplay({
  avatarUrl,
  size = 'md',
  label,
}: {
  avatarUrl: string | null;
  size?: keyof typeof SIZE_CLASSES;
  label?: string;
}) {
  const preset = avatarUrl ? AVATAR_PRESETS[avatarUrl] : undefined;
  const baseClasses = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ${SIZE_CLASSES[size]}`;

  if (preset) {
    return (
      <span className={baseClasses} role="img" aria-label={label ?? 'Avatar'}>
        {preset}
      </span>
    );
  }

  if (avatarUrl) {
    // URL dowolnej domeny (użytkownik wkleja własny link) - next/image
    // wymagałby skonfigurowania dozwolonych hostów z góry.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      // referrerPolicy: adres strony (z tokenami w query na /verify-email itp.) nie
      // może wyciec do serwera, z którego user wskazał obrazek.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={label ?? 'Avatar'} className={baseClasses} referrerPolicy="no-referrer" />
    );
  }

  return (
    <span className={baseClasses} role="img" aria-label={label ?? 'Brak avatara'}>
      👤
    </span>
  );
}
