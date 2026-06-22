/**
 * Joins a list of class name fragments, filtering out falsy values.
 * Shared utility used by MeterBar, ManaSymbol, SetSymbol, and other
 * components that conditionally assemble className strings.
 */
export function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
