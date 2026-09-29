// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIcs, downloadIcs, googleCalendarUrl } from './calendar-links';

// 2026-07-10T19:00:00.000Z
const START = Date.UTC(2026, 6, 10, 19, 0, 0);

const EVENT = {
  title: 'Friday commander',
  startsAt: START,
  location: "Sam's place",
  description: 'Bring bracket 2 decks',
  url: 'https://spellcontrol.com/gn/tok123',
};

describe('googleCalendarUrl', () => {
  it('builds a template URL with UTC start/end and details', () => {
    const url = new URL(googleCalendarUrl(EVENT));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Friday commander');
    // Default duration is 3h.
    expect(url.searchParams.get('dates')).toBe('20260710T190000Z/20260710T220000Z');
    expect(url.searchParams.get('location')).toBe("Sam's place");
    expect(url.searchParams.get('details')).toContain('Bring bracket 2 decks');
    expect(url.searchParams.get('details')).toContain('https://spellcontrol.com/gn/tok123');
  });

  it('honors a custom duration and omits empty fields', () => {
    const url = new URL(
      googleCalendarUrl({ title: 'Quick draft', startsAt: START, durationMs: 60 * 60 * 1000 })
    );
    expect(url.searchParams.get('dates')).toBe('20260710T190000Z/20260710T200000Z');
    expect(url.searchParams.get('location')).toBeNull();
    expect(url.searchParams.get('details')).toBeNull();
  });
});

describe('buildIcs', () => {
  it('emits a valid single-event VCALENDAR with CRLF line endings', () => {
    const ics = buildIcs(EVENT, 'tok123@spellcontrol.com');
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('UID:tok123@spellcontrol.com\r\n');
    expect(ics).toContain('DTSTART:20260710T190000Z\r\n');
    expect(ics).toContain('DTEND:20260710T220000Z\r\n');
    expect(ics).toContain('SUMMARY:Friday commander\r\n');
    expect(ics).toContain("LOCATION:Sam's place\r\n");
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes RFC 5545 specials in text fields', () => {
    const ics = buildIcs(
      {
        title: 'Cube; night, with\nnewline',
        startsAt: START,
        location: 'Back\\room',
      },
      'uid'
    );
    expect(ics).toContain('SUMMARY:Cube\\; night\\, with\\nnewline');
    expect(ics).toContain('LOCATION:Back\\\\room');
  });
});

describe('downloadIcs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates and clicks a temporary download anchor', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadIcs(EVENT, 'uid', 'game-night.ics');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(document.querySelector('a[download]')).toBeNull(); // cleaned up
    click.mockRestore();
  });
});
