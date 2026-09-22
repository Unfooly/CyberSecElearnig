export class DashboardOverviewDto {
  // % ukończonych CourseAssignment wśród obowiązkowych przypisań (mandatory
  // = true, per przypisanie - D-065). Kursy opcjonalne (w tym samoobsługowe
  // z katalogu) nie wchodzą ani do licznika, ani do mianownika.
  // null, gdy organizacja nie ma jeszcze żadnego obowiązkowego przypisania.
  completionRate!: number | null;

  // Liczba userów z co najmniej jednym IN_PROGRESS/COMPLETED assignment,
  // oraz łączna liczba userów w organizacji.
  activeUsers!: { count: number; total: number };

  overdueCount!: number;

  // KPI "podatność na phishing": % dostarczonych wiadomości symulacji z kliknięciem / wysłaniem formularza w kampaniach
  // z ostatnich 90 dni (cała organizacja). null = brak kampanii albo za mało danych (mniej niż 3 osoby z dostarczoną
  // wiadomością - próg minimalnej liczebności). Żadnych danych osobowych.
  phishingClickRate!: number | null;
  phishingSubmitRate!: number | null;

  // KPI "zgłaszalność": % dostarczonych wiadomości symulacji zgłoszonych przez adresata jako podejrzane (moduł zgłoszeń;
  // te same 90 dni, ta sama liczebność i próg co powyżej). null = brak kampanii albo za mało danych.
  phishingReportRate!: number | null;
}
