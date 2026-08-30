/**
 * Date formatting used in rendered markup.
 *
 * Server components may render in a different locale/time zone than the
 * browser. Always provide both explicitly so the first client render matches
 * the HTML sent by Next.js. The ISO value remains available to assistive
 * technology through the surrounding `dateTime` attributes where applicable.
 */
const DISPLAY_LOCALE = "en-US";
const DISPLAY_TIME_ZONE = "UTC";

function format(value: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    ...options,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function formatDateTime(value: string) {
  return format(value, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(value: string) {
  return format(value, { dateStyle: "medium" });
}

export function formatShortDate(value: string) {
  return format(value, { month: "short", day: "numeric" });
}

export function formatTime(value: string) {
  return format(value, { hour: "numeric", minute: "2-digit" });
}

export function formatCompactDateTime(value: string) {
  return format(value, { dateStyle: "short", timeStyle: "short" });
}
