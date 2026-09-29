import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { NotesProvider, useNotes } from './notes';
import type { ClientNote } from '@/lib/courses-types';

// addNote: bez duplikatów (ten sam blok i tekst), a notatka dodana w bloku (bez odnośnika) dostaje `ref`, gdy serwer ją zapisze (D-118).
describe('NotesProvider.addNote', () => {
  function setup(initial: ClientNote[] = []) {
    const api: { current: ReturnType<typeof useNotes> | null } = { current: null };
    function Probe() {
      api.current = useNotes();
      return null;
    }
    render(
      <NotesProvider initial={initial}>
        <Probe />
      </NotesProvider>,
    );
    return api;
  }

  it('notatka z bloku, potem ta sama z serwera z odnośnikiem - jeden wpis z ref', () => {
    const api = setup();
    act(() => api.current!.addNote({ blockId: 'scena', text: 'Hasło na kartce.', kind: 'item' }));
    act(() => api.current!.addNote({ blockId: 'scena', text: 'Hasło na kartce.', kind: 'item', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa' }));
    expect(api.current!.notes).toEqual([{ blockId: 'scena', text: 'Hasło na kartce.', kind: 'item', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa' }]);
  });

  it('istniejący odnośnik nie jest nadpisywany; duplikat bez odnośnika niczego nie zmienia', () => {
    const api = setup([{ blockId: 'scena', text: 'X', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa' }]);
    act(() => api.current!.addNote({ blockId: 'scena', text: 'X', ref: 'bbbbbbbbbbbbbbbbbbbbbbbb' }));
    act(() => api.current!.addNote({ blockId: 'scena', text: 'X' }));
    expect(api.current!.notes).toEqual([{ blockId: 'scena', text: 'X', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa' }]);
  });
});
