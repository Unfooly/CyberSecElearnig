// Avatar z inicjałami na tle accent-soft (32 px, BRAND.md).
export function initialsFrom(firstName: string | null, lastName: string | null, email: string): string {
  const first = firstName?.trim()[0];
  const last = lastName?.trim()[0];
  if (first || last) {
    return `${first ?? ''}${last ?? ''}`.toUpperCase();
  }
  const segments = (email.split('@')[0] ?? '').split(/[._-]+/).filter(Boolean);
  return `${segments[0]?.[0] ?? '?'}${segments[1]?.[0] ?? ''}`.toUpperCase();
}

export default function InitialsAvatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink"
    >
      {initials}
    </span>
  );
}
