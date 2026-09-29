export interface PresetColor {
  hex: string;
  name: string;
}

export const PRESET_COLORS: PresetColor[] = [
  { hex: '#7a8a70', name: 'Sage' },
  { hex: '#3878c0', name: 'Blue' },
  { hex: '#7060a0', name: 'Purple' },
  { hex: '#d05030', name: 'Red' },
  { hex: '#409040', name: 'Green' },
  { hex: '#c89820', name: 'Gold' },
  { hex: '#909090', name: 'Gray' },
  { hex: '#a08040', name: 'Brown' },
  { hex: '#c878a8', name: 'Pink' },
];

export function pickRandomPresetColor(): string {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)].hex;
}
