// Ta sama lista co CourseCategory w apps/api/prisma/schema.prisma - front nie ma dziś endpointu zwracającego dostępne kategorie, więc
// trzymane tu (biblioteka kursów i ekran startu modułu, D-163).
export const CATEGORY_LABELS: Record<string, string> = {
  PHISHING_SOCIAL_ENGINEERING: 'Phishing i inżynieria społeczna',
  EMAIL_SECURITY: 'Bezpieczeństwo e-mail',
  IT_HYGIENE: 'Higiena IT',
  INCIDENT_RESPONSE: 'Reagowanie na incydenty',
  MALWARE: 'Złośliwe oprogramowanie',
  GENERAL_AWARENESS: 'Świadomość ogólna',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
