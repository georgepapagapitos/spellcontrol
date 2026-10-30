/** Which zone the add-cards sheet lands cards in. */
export type AddZone = 'main' | 'side' | 'considering' | 'box';

/** Each add zone's name, as the toggle and the drop overlay show it. */
export const ADD_ZONE_LABELS: Record<AddZone, string> = {
  main: 'Mainboard',
  side: 'Sideboard',
  considering: 'Considering',
  box: 'In the box',
};
