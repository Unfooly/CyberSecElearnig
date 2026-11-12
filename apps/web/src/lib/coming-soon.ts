// Strona „w budowie” pod „/” (D-157): COMING_SOON=1 w środowisku apps/web (.env.prod), domyślnie wyłączona. Czytana przy każdym
// żądaniu (strony są dynamiczne, D-053), więc przełączenie wymaga tylko odtworzenia kontenera web (`up -d --force-recreate web`;
// sam `docker compose restart` nie czyta ponownie env_file), bez przebudowy obrazu.
// Zmienia WYŁĄCZNIE „/” dla niezalogowanych; pozostałe trasy i API działają bez zmian.
export function comingSoonEnabled(): boolean {
  return process.env.COMING_SOON === '1';
}
