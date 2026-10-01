import { OUTDATED_AFTER_MS, TIME_ZONE } from './constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Numeric parts keep the output identical across ICU versions, which disagree on "Sep" vs "Sept".
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

function singaporeParts(date: Date) {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function formatReadingTime(iso: string, now: Date = new Date()): string {
  const reading = singaporeParts(new Date(iso));
  const today = singaporeParts(now);
  const time = `${reading.hour % 12 || 12}:${String(reading.minute).padStart(2, '0')} ${
    reading.hour < 12 ? 'am' : 'pm'
  }`;
  const sameDay =
    reading.year === today.year && reading.month === today.month && reading.day === today.day;
  return sameDay ? time : `${reading.day} ${MONTHS[reading.month - 1]}, ${time}`;
}

export function isReadingOutdated(iso: string, now: number): boolean {
  return now - Date.parse(iso) > OUTDATED_AFTER_MS;
}
