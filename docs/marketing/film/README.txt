Film Unfooly (26 s, 1920x1080)
  unfooly-film.html  -> docs/marketing/film/unfooly-film.html  (zrodlo animacji; podglad w przegladarce)
  render-film.mjs    -> docs/marketing/film/render-film.mjs    (render do MP4 + plakat JPG)
Wynik renderu trafia do docs/marketing/film/out/ (w .gitignore).

Render (z katalogu repo):
  1. npm install --prefix docs/marketing/film
     (ffmpeg-static - osobny package.json, poza workspace'ami: nie trafia do lockfile'a korzenia ani do obrazow Dockera;
      jego skrypt instalacyjny pobiera binarke ffmpeg. Jesli Twoj npm blokuje skrypty instalacyjne, zatwierdz go:
      `npm install-scripts approve ffmpeg-static` w tym katalogu (wpis "allowScripts" w package.json). Z ffmpeg w PATH krok 1 mozna pominac.)
  2. node docs/marketing/film/render-film.mjs
     Potrzebny internet (Google Fonts). Bez fontu Plus Jakarta Sans skrypt przerywa - nie obchodzic tego.
  3. Skopiuj out/unfooly-film.mp4 (<= 6 MB; wiekszy -> wyzsze -crf) i out/unfooly-film-poster.jpg do apps/web/public/marketing/.
     Strona glowna: apps/web/src/app/_landing/FilmSection.tsx (D-091).
