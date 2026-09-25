import '@testing-library/jest-dom/vitest';

// jsdom nie implementuje window.matchMedia - domyślny, statyczny mock (matches: false, addEventListener/
// removeEventListener jako no-opy) wystarcza większości komponentów; testy, którym zależy na SYMULACJI zmiany
// (np. przejścia przez breakpoint), same podmieniają window.matchMedia lokalnie i przechwytują zarejestrowany listener.
// typeof window - część plików testowych deklaruje `// @vitest-environment node` (trasy API: FormData/File z Node,
// nie jsdom), gdzie window w ogóle nie istnieje.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
