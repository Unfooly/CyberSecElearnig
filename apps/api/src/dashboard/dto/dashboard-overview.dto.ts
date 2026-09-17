export class DashboardOverviewDto {
  // % ukończonych CourseAssignment wśród obowiązkowych kursów (course.mandatory
  // = true). Kursy opcjonalne nie wchodzą ani do licznika, ani do mianownika.
  // null, gdy organizacja nie ma jeszcze żadnego obowiązkowego przypisania.
  completionRate!: number | null;

  // Liczba userów z co najmniej jednym IN_PROGRESS/COMPLETED assignment,
  // oraz łączna liczba userów w organizacji.
  activeUsers!: { count: number; total: number };

  overdueCount!: number;

  // Placeholdery do czasu modułu symulacji phishingowych - świadomie null,
  // nie zmyślone liczby.
  phishingClickRate!: null;
  phishingReportRate!: null;
}
