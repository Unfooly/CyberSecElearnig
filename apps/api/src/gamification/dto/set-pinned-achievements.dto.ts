import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';
import { MAX_PINNED_ACHIEVEMENTS, PIN_LIMIT_MESSAGE } from '../gamification.constants';

/**
 * Cała lista przypiętych osiągnięć (D-112) w kolejności na profilu - przypięcie, odpięcie i zmiana kolejności to ten sam zapis.
 * Tylko kody; czy są zdobyte i bez duplikatów, sprawdza serwis (GamificationService.setPinnedAchievements).
 */
export class SetPinnedAchievementsDto {
  @IsArray()
  @ArrayMaxSize(MAX_PINNED_ACHIEVEMENTS, { message: PIN_LIMIT_MESSAGE })
  @IsString({ each: true })
  @Matches(/^[a-z0-9-]{1,64}$/, { each: true, message: 'Nieprawidłowy kod osiągnięcia.' })
  codes!: string[];
}
