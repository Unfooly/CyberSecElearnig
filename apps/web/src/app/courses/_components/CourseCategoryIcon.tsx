import { Bug, KeyRound, LifeBuoy, Mail, ShieldCheck, Siren, type LucideIcon } from 'lucide-react';

// Zamiast miniaturek-obrazków (brak assetów, brak gradientów wg BRAND.md):
// ikona kategorii na jednolitym tle soft. Ton zależy od statusu kursu.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  PHISHING_SOCIAL_ENGINEERING: Mail,
  EMAIL_SECURITY: Mail,
  IT_HYGIENE: KeyRound,
  INCIDENT_RESPONSE: Siren,
  MALWARE: Bug,
  GENERAL_AWARENESS: ShieldCheck,
};

export type CourseIconTone = 'acc' | 'ok' | 'warn';

const TONES: Record<CourseIconTone, string> = {
  acc: 'bg-accent-soft text-accent-ink',
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
};

export default function CourseCategoryIcon({ category, tone = 'acc' }: { category: string; tone?: CourseIconTone }) {
  const Icon = CATEGORY_ICONS[category] ?? LifeBuoy;
  return (
    <div className={`flex h-24 items-center justify-center rounded-xl ${TONES[tone]}`} aria-hidden="true">
      <Icon size={28} strokeWidth={2} />
    </div>
  );
}
