import type { ReactNode } from 'react';

const SIZES = {
  760: 'max-w-[760px]',
  900: 'max-w-[900px]',
  1080: 'max-w-[1080px]',
  1280: 'max-w-[1280px]',
} as const;

// Wspólny kontener stron zalogowanych (feat/mobile-app-shell): gutter 16 px na telefonie (px-4), rosnący do 40 px od
// lg (px-10) - dokładnie tak jak każda z 12 stron miała dziś na desktopie, tylko bez sztywnego px-10 na wąskich
// ekranach, które wypychało stronę w bok (poziome przewijanie przy 360 px). `size` = max-w-[Npx] z dawnego className
// tej konkretnej strony - podmieniamy WYŁĄCZNIE gutter, nie układ wewnątrz stron.
export default function PageContainer({ size, children }: { size: 760 | 900 | 1080 | 1280; children: ReactNode }) {
  return <main className={`mx-auto w-full ${SIZES[size]} px-4 pb-12 pt-6 sm:px-6 sm:pt-9 lg:px-10`}>{children}</main>;
}
