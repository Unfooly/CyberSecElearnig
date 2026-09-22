import { Role } from '../enums/role.enum';

// SUPER_ADMIN i RESELLER_ADMIN celowo wykluczone - to role operatora platformy
// (panel operacyjny) i partnera (D-069), nadawane wyłącznie przez operatora, nie
// przez self-service invite/edycję w organizacji-kliencie. Używane zarówno w apps/api (walidacja DTO, @IsIn) jak i
// apps/web (lista rozwijana ról w modalu zapraszania/edycji).
// `as const` - pozwala apps/web zawęzić typ do dokładnie tych 3 wartości
// (AssignableRole = (typeof ASSIGNABLE_ROLES)[number]) zamiast szerokiego Role.
export const ASSIGNABLE_ROLES = [Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER, Role.EMPLOYEE] as const;
