/**
 * Add-to-calendar helpers for game nights: a Google Calendar template URL and
 * a downloadable .ics — both pure string-building, no dependencies. The .ics
 * works with Apple/Outlook/Google; the template URL is the one-tap path for
 * Google users.
 */

export interface CalendarEvent {
  title: string;
  /** Epoch ms. */
  startsAt: number;
  /** Defaults to three hours — a typical commander night. */
  durationMs?: number;
  location?: string | null;
  description?: string | null;
  /** Link back to the RSVP page, embedded in the event body. */
  url?: string;
}

const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

/** 20260710T190000Z — the UTC "basic" format both Google and RFC 5545 want. */
function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function eventWindow(ev: CalendarEvent): { start: string; end: string } {
  return {
    start: utcStamp(ev.startsAt),
    end: utcStamp(ev.startsAt + (ev.durationMs ?? DEFAULT_DURATION_MS)),
  };
}

function eventDetails(ev: CalendarEvent): string {
  return [ev.description, ev.url].filter(Boolean).join('\n\n');
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const { start, end } = eventWindow(ev);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${start}/${end}`,
  });
  const details = eventDetails(ev);
  if (details) params.set('details', details);
  if (ev.location) params.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 text escaping: backslash, semicolon, comma, newline. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * A minimal single-event VCALENDAR. `uid` must be stable per night so
 * re-importing updates the event instead of duplicating it.
 */
// ponytail: no 75-octet line folding — every consumer tested tolerates long lines;
// add folding if some calendar app ever chokes.
export function buildIcs(ev: CalendarEvent, uid: string): string {
  const { start, end } = eventWindow(ev);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SpellControl//Game Night//EN',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  const details = eventDetails(ev);
  if (details) lines.push(`DESCRIPTION:${icsEscape(details)}`);
  if (ev.url) lines.push(`URL:${ev.url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Trigger a browser download of the event as an .ics file. */
export function downloadIcs(ev: CalendarEvent, uid: string, filename: string): void {
  const blob = new Blob([buildIcs(ev, uid)], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
