import type { ReactNode } from 'react';

// ZAMKNIĘTY, wąski podzbiór markdown do treści kursu (TABS/SUMMARY/NARRATIVE): pogrubienie (**tekst**), kod (`tekst`),
// listy wypunktowane (linia zaczynająca się od "- "/"* "), listy numerowane (linia zaczynająca się od "1. ", "2. " itd. -
// numerację nadaje wyłącznie <ol> bez atrybutu value, więc oryginalne cyfry w treści są tylko znacznikiem "to jest lista",
// nie liczą się dosłownie) i akapity (puste linie). Nowy element treści = nowe pytanie do właściciela produktu, nie kolejne
// ciche rozszerzenie (packages/content/README.md, "Katalog modułu"). CELOWO bez HTML i bez linków: React renderuje string
// jako zwykły tekst (nie parsuje go jako znaczniki), więc `<b>` czy `[link](adres)` w treści wychodzą na ekranie dosłownie
// (nawet wewnątrz `code` - patrz test) - nigdy nie używamy dangerouslySetInnerHTML.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

const LIST_KINDS = {
  ul: { marker: /^[-*]\s+/, className: 'list-disc space-y-1 pl-5' },
  ol: { marker: /^\d+\.\s+/, className: 'list-decimal space-y-1 pl-5' },
} as const;
const isBulletLine = (line: string) => LIST_KINDS.ul.marker.test(line);
const isOrderedLine = (line: string) => LIST_KINDS.ol.marker.test(line);

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter((line) => line.length > 0);
        const listTag = lines.length === 0 ? null : lines.every(isBulletLine) ? 'ul' : lines.every(isOrderedLine) ? 'ol' : null;
        if (listTag) {
          const { marker, className } = LIST_KINDS[listTag];
          const ListTag = listTag;
          return (
            <ListTag key={blockIndex} className={className}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.replace(marker, ''), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInline(line, `${blockIndex}-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
