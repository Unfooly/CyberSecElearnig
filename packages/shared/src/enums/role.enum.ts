export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  // Partner sprzedający platformę i obsługujący wiele organizacji klienckich (D-069).
  // Żyje w organizacji z `kind = RESELLER`, nie w organizacji klienta; widzi wyłącznie
  // listę przypisanych mu klientów, nigdy ich danych (wejście w organizację to osobny krok).
  RESELLER_ADMIN = 'RESELLER_ADMIN',
  ORG_ADMIN = 'ORG_ADMIN',
  DEPARTMENT_MANAGER = 'DEPARTMENT_MANAGER',
  EMPLOYEE = 'EMPLOYEE',
}
