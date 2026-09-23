/** Paleta scen Unfooly — spójna z maskotką Fooli (packages/content/mascot). */
export const P = {
  ink: '#2B2440',
  purple: '#6C5CE7',
  purpleDark: '#4E40B8',
  orange: '#F0883A',
  wall: '#EEF0FA',
  wall2: '#E3E6F5',
  floor: '#CFD3E8',
  desk: '#D9C3A5',
  deskDark: '#B89C7A',
  white: '#FFFFFF',
  grey: '#B8BAD0',
  greyDark: '#8C8FA8',
  screen: '#F7F8FF',
  red: '#E5484D',
  yellow: '#FFE066',
  yellowDark: '#E6C845',
  green: '#2FB36B',
  teal: '#3AA6B9',
  sky: '#DDEBFF',
  sun: '#FFF3B0',
} as const;

export type PaletteKey = keyof typeof P;
