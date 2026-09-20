export class DashboardOverviewDto {
  // % ukończonych CourseAssignment wśród obowiązkowych kursów (course.mandatory
  // = true). Kursy opcjonalne nie wchodzą ani do licznika, ani do mianownika.
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

  // Placeholder do czasu modułu zgłaszania zagrożeń - świadomie null, nie zmyślone liczby.
  phishingReportRate!: null;
}
