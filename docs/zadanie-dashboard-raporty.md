Zbuduj moduł dashboard/raporty (apps/api/src/dashboard/), oparty o dane, które już istnieją
(Organization, User, Department, CourseAssignment). Symulacji phishingowych jeszcze nie ma —
miejsca na te metryki mają zwracać null/brak danych, nie zmyślone liczby.

Endpointy (wszystkie pod JwtAuthGuard, organizationId wyłącznie z JWT):

1. GET /dashboard/overview (rola: ORG_ADMIN)
   Zwraca dla organizacji zalogowanego admina:
   - completionRate: % ukończonych CourseAssignment wśród obowiązkowych kursów
   - activeUsers: liczba userów z co najmniej jednym IN_PROGRESS/COMPLETED assignment / liczba wszystkich userów
   - overdueCount: liczba CourseAssignment ze status OVERDUE
   - phishingClickRate: null (placeholder do czasu modułu symulacji)
   - phishingReportRate: null (placeholder)

2. GET /dashboard/departments (rola: ORG_ADMIN)
   Rozbicie completionRate per Department w organizacji, posortowane malejąco wg ryzyka
   (najniższy completionRate pierwszy).

3. GET /dashboard/export?format=csv (rola: ORG_ADMIN)
   Eksport CSV: lista userów organizacji z ich statusami przypisań kursów (jedna linia per user,
   kolumny: email, dział, liczba ukończonych/wszystkich obowiązkowych kursów, ostatnia aktywność).
   PDF na razie pomiń - to osobne zadanie, jeśli będzie potrzebne.

4. GET /dashboard/admin/organizations (rola: SUPER_ADMIN, TYLKO ta rola - inne 403)
   Przegląd wszystkich organizacji: nazwa, plan, liczba userów, seatsLimit, ogólny completionRate,
   data ostatniej aktywności. To jedyny endpoint w całym projekcie, który świadomie nie filtruje
   po organizationId requestera - upewnij się, że guard sprawdza rolę SUPER_ADMIN PRZED
   wykonaniem jakiegokolwiek zapytania, i że żaden inny endpoint w projekcie nie ma tego wyjątku.

Testy:
- happy path dla każdego endpointu
- izolacja tenantów: ORG_ADMIN organizacji A nie widzi danych organizacji B w /overview
  i /departments (nawet nie przez manipulację parametrami - endpoint nie powinien w ogóle
  przyjmować organizationId jako parametru)
- kontrola dostępu: EMPLOYEE nie ma dostępu do /dashboard/* (403), zwykły ORG_ADMIN nie ma
  dostępu do /dashboard/admin/organizations (403)

Przedstaw plan przed kodem, jak zwykle - w szczególności jak dokładnie liczysz completionRate
(które statusy się liczą, czy kursy opcjonalne wchodzą do mianownika) i jak podchodzisz do
wydajności zapytań agregujących (żeby nie robić N+1 przy liczeniu per-department).
