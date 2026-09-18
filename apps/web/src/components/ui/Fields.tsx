import { ChevronDown, Search } from 'lucide-react';
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

const CONTROL =
  'h-10 rounded-btn border border-border bg-surface font-medium text-ink placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft';

// Pole wyszukiwania z ikoną lupy (mockupy: 40 px, ikona 16 px po lewej).
export function SearchInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} strokeWidth={2.2} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-muted" />
      <input type="search" className={`${CONTROL} w-full pl-9 pr-3`} {...rest} />
    </div>
  );
}

// Select z własną strzałką (natywna wyłączona przez appearance-none).
export function SelectField({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className}`}>
      <select className={`${CONTROL} w-full appearance-none pl-3 pr-9`} {...rest}>
        {children}
      </select>
      <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-3 top-3 text-muted" />
    </div>
  );
}
