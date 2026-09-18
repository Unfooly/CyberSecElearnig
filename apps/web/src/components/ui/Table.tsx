import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

// Cienkie wrappery na style tabeli z BRAND.md: nagłówek 12 px uppercase,
// wiersze 14 px padding, hover #FAFAF8, ostatni wiersz bez dolnej krawędzi.
export function Table({ className = '', ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-left ${className}`} {...rest} />
    </div>
  );
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`border-b border-border px-5 py-3.5 text-xs font-bold uppercase tracking-[0.04em] text-muted ${className}`}
      {...rest}
    />
  );
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`group ${className}`} {...rest} />;
}

export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`border-b border-border px-5 py-3.5 align-middle group-hover:bg-[#FAFAF8] group-last:border-b-0 ${className}`}
      {...rest}
    />
  );
}
