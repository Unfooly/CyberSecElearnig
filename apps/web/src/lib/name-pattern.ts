// Lustro apps/api/src/users/name-pattern.ts - imię/nazwisko trafia do maili z
// zaproszeniem, więc tylko litery (Unicode), spacje, kropka, apostrof i
// myślnik. Backend jest autorytatywny, to tylko podgląd/UX.
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;
export const NAME_PATTERN_MESSAGE = 'Dozwolone tylko litery, spacje, kropka, apostrof i myślnik.';
