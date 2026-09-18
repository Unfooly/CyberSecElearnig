import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-accent text-white hover:bg-accent-hover',
  secondary: 'border-border bg-surface text-ink hover:bg-paper',
  ghost: 'border-transparent bg-transparent text-accent-ink hover:bg-accent-soft',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: 'md' | 'sm' = 'md'): string {
  const sizing = size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm';
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn border font-bold transition-colors disabled:cursor-default disabled:opacity-50 ${sizing} ${VARIANTS[variant]}`;
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  type = 'button',
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`${buttonClasses(variant, size)} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

// Link wyglądający jak przycisk (nawigacja / pobranie pliku).
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  href,
  children,
  ...rest
}: CommonProps & { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const classes = `${buttonClasses(variant, size)} ${className}`;
  // Ścieżki API / pliki nie mogą iść przez router Next.
  if (href.startsWith('/api/')) {
    return (
      <a href={href} className={classes} {...rest}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
