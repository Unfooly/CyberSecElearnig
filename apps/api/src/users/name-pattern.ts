// Imię/nazwisko trafia do maili z zaproszeniem wysyłanych z domeny platformy -
// dopuszczamy wyłącznie litery (Unicode), spacje, kropkę, apostrof i myślnik,
// bez cyfr, znaków nowej linii i interpunkcji. Inaczej ORG_ADMIN mógłby
// wpisać w "imię" całą frazę phishingową ("Twoje konto zostanie zablokowane,
// kliknij ...") i wysłać ją do dowolnej skrzynki jako "zaproszenie".
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;
export const NAME_PATTERN_MESSAGE = 'Imię i nazwisko mogą zawierać tylko litery, spacje, kropkę, apostrof i myślnik.';
