import { IsString, Matches, MaxLength } from 'class-validator';

// Podważenie kwestii przesłuchania (INTERROGATION, D-118): id kwestii (publiczne, z treści bloku) i nieprzejrzysty odnośnik notatki z
// notatnika gracza (`ref` z widoku postępu). Klient nie wysyła treści ani klucza notatki - serwer tłumaczy odnośnik sam.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class ChallengeBlockDto {
  @IsString()
  @MaxLength(64)
  @Matches(ID)
  lineId!: string;

  // Odnośnik to zawsze 24 znaki hex (opaqueId, client-view.ts noteRef).
  @IsString()
  @Matches(/^[a-f0-9]{24}$/)
  noteRef!: string;
}
