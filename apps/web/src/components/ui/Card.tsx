import type { HTMLAttributes, ReactNode } from 'react';

export default function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-card border border-border bg-surface shadow-card ${className}`} {...rest} />;
}

// Nagłówek karty z separatorem: tytuł po lewej, opcjonalna akcja po prawej.
export function CardHeader({ title, action, id }: { title: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
      <h2 id={id} className="text-lg font-bold tracking-[-0.01em]">
        {title}
      </h2>
      {action}
    </div>
  );
}
