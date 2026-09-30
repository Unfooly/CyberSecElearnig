import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Matches, MaxLength } from 'class-validator';

// Stan częściowy sceny (SCENE_HOTSPOTS, D-128): id obejrzanych przedmiotów i zabranych dowodów (publiczne, z treści bloku). Klient nie
// wysyła treści notatek ani punktów - serwer sprawdza id z treścią bloku i sam dopisuje notatki.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Ten sam limit co listy id w zapisie bloku (/progress, evaluate.ts `ids`) - sceny z większą liczbą przedmiotów i tak nie da się
// ukończyć; id spoza bloku odrzuca serwis (evaluateExploration).
const MAX_ITEMS = 50;

export class ExploreBlockDto {
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(ID, { each: true })
  visited!: string[];

  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(ID, { each: true })
  noted!: string[];
}
