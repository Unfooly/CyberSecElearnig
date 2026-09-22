import type { ReactNode } from 'react';

// Bardzo wąski podzbiór markdown do treści kursu (TABS/SUMMARY): pogrubienie (**tekst**), listy (linia zaczynająca się od "- "/"* ")
// i akapity (puste linie). CELOWO bez HTML i bez linków: React renderuje string jako zwykły tekst (nie parsuje go jako znaczniki), więc
// `<b>` czy `[link](adres)` w treści wychodzą na ekranie dosłownie - nigdy nie używamy dangerouslySetInnerHTML.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-${index}`}>{part}</span>
    ),
  );
}

const isListLine = (line: string) => /^[-*]\s+/.test(line);

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter((line) => line.length > 0);
        if (lines.length > 0 && lines.every(isListLine)) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.replace(/^[-*]\s+/, ''), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ul>
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
