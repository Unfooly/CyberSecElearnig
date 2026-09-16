import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CyberSzkoło',
  description: 'Platforma szkoleń z cyberbezpieczeństwa i symulacji phishingowych',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
