// Startowa lista slugów presetów - frontend mapuje slug -> obrazek. Backend
// nie przechowuje samych plików, tylko waliduje, że przesłany slug jest na
// tej liście (patrz UsersService.assertValidAvatar).
export const AVATAR_PRESETS = [
  'fox',
  'owl',
  'wolf',
  'eagle',
  'bear',
  'shield',
  'robot',
  'ninja',
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
