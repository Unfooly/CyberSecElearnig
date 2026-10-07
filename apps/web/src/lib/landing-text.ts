import type { ContentLocale } from '@cyberszkolo/content';

// Teksty strony lądowania symulacji w obsługiwanych językach (D-133) - neutralne, bez marki serwisu (B-141). Lekcja „To była symulacja”
// pochodzi z kampanii (lessonHtml) i jest w jej języku.

export interface LandingText {
  title: string;
  intro: string;
  email: string;
  password: string;
  confirm: string;
  cancel: string;
  exercise: string;
  lesson: string;
  close: string;
}

export const LANDING_TEXT: Record<ContentLocale, LandingText> = {
  pl: {
    title: 'Weryfikacja konta',
    intro: 'Ze względów bezpieczeństwa potwierdź swoją tożsamość, aby zachować dostęp do konta służbowego.',
    email: 'Adres e-mail',
    password: 'Hasło',
    confirm: 'Potwierdź',
    cancel: 'Anuluj',
    exercise: 'Ćwiczenie bezpieczeństwa',
    lesson: 'Lekcja',
    close: 'Możesz zamknąć tę kartę. Kurs uzupełniający znajdziesz po zalogowaniu do platformy szkoleniowej.',
  },
  en: {
    title: 'Account verification',
    intro: 'For security reasons, please confirm your identity to keep access to your work account.',
    email: 'Email address',
    password: 'Password',
    confirm: 'Confirm',
    cancel: 'Cancel',
    exercise: 'Security exercise',
    lesson: 'Lesson',
    close: 'You can close this tab. A follow-up course is waiting for you after you sign in to the training platform.',
  },
};
