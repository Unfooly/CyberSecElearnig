# Backlog treści szkoleniowych (moduł e-learning)

## Kategorie i tematy na start (14 kursów)

### Obowiązkowe (moduł fundamentalny — przypisywany każdemu nowemu pracownikowi)

| Temat | Czas (min) | Typ bloków |
|---|---|---|
| Czym jest phishing i jak manipuluje | 6 | wideo + quiz |
| Rozpoznawanie fałszywych adresów e-mail | 8 | wideo + scenariusz rozgałęziony |
| Niebezpieczne załączniki i linki | 6 | wideo + drag&drop (posegreguj maile) |
| Co robić przy podejrzanym incydencie | 4 | wideo + quiz |
| Menadżer haseł i higiena haseł | 4 | wideo + quiz |

### Opcjonalne (rozszerzenie, przypisywane wg działu/roli)

| Temat | Czas (min) | Typ bloków |
|---|---|---|
| Spear phishing (ataki celowane) | 8 | scenariusz rozgałęziony |
| Vishing (phishing głosowy) | 8 | wideo + quiz |
| Bezpieczeństwo komunikatorów | 10 | wideo + quiz |
| Shadow IT | 6 | wideo + quiz |
| Ransomware i złośliwe oprogramowanie | 3 | wideo + quiz |
| Bezpieczne typy plików | 8 | drag&drop + quiz |
| Zarządzanie dostępem (MFA, least privilege) | 7 | wideo + quiz |
| Inżynieria społeczna — zbieranie informacji | 5 | scenariusz rozgałęziony |
| IT jako częsty cel ataków | 9 | wideo + quiz |

## Rozszerzenie modelu Course (Prisma)

Do zaimplementowania jako osobne zadanie dla agenta:

```prisma
enum CourseCategory {
  PHISHING_SOCIAL_ENGINEERING
  EMAIL_SECURITY
  IT_HYGIENE
  INCIDENT_RESPONSE
  MALWARE
  GENERAL_AWARENESS
}

enum ContentBlockType {
  VIDEO
  QUIZ
  BRANCHING_SCENARIO
  DRAG_AND_DROP
}

model Course {
  id                String         @id @default(cuid())
  title             String
  category          CourseCategory
  durationMinutes   Int
  mandatory         Boolean        @default(false)
  contentBlocks     Json           // uporządkowana lista bloków treści, patrz niżej
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  assignments       CourseAssignment[]
}

model CourseAssignment {
  id             String    @id @default(cuid())
  organizationId String
  userId         String
  courseId       String
  status         AssignmentStatus @default(NOT_STARTED)
  score          Int?
  dueDate        DateTime?
  completedAt    DateTime?
  createdAt      DateTime  @default(now())

  user User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([userId])
}

enum AssignmentStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  OVERDUE
}
```

### Format `contentBlocks` (JSON)

Przykład dla kursu "Rozpoznawanie fałszywych adresów e-mail":

```json
[
  { "type": "VIDEO", "url": "...", "durationSeconds": 180 },
  {
    "type": "BRANCHING_SCENARIO",
    "prompt": "Dostałeś maila od 'dostawcy' z pilną prośbą o płatność. Co robisz?",
    "options": [
      { "text": "Klikam link i płacę od razu", "outcome": "wrong", "feedback": "..." },
      { "text": "Sprawdzam adres nadawcy i dzwonię do dostawcy", "outcome": "correct", "feedback": "..." }
    ]
  }
]
```

Uwaga dla implementacji: `organizationId` na `CourseAssignment` (nie tylko przez relację `user.organizationId`) — zgodnie z Zasadą nr 1 z CLAUDE.md, każde zapytanie filtruje bezpośrednio po tej kolumnie, bez polegania na joinie.
