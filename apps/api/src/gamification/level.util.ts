// level = floor(sqrt(xp / 100)) + 1  <=>  próg wejścia na poziom L to
// (L-1)^2 * 100 XP, próg następnego poziomu to L^2 * 100 XP. Rozpisane w
// planie tej sesji - level=1 dla xp=0..99, level=2 od xp=100, itd.

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function xpForLevelStart(level: number): number {
  return (level - 1) ** 2 * 100;
}

export function xpForNextLevel(level: number): number {
  return level ** 2 * 100;
}

export function currentLevelProgressPercent(xp: number, level: number): number {
  const start = xpForLevelStart(level);
  const next = xpForNextLevel(level);
  if (next <= start) {
    return 100;
  }
  return Math.round(((xp - start) / (next - start)) * 100);
}
