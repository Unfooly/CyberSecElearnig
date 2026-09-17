export class DepartmentCompletionDto {
  // null = użytkownicy bez przypisanego działu ("Brak działu").
  departmentId!: string | null;
  departmentName!: string;
  completionRate!: number | null;
  mandatoryTotal!: number;
  mandatoryCompleted!: number;
}
