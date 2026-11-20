export const APP_TIME_ZONE = 'Asia/Yangon'

// Yangon has no daylight saving time, so its UTC offset is always +06:30.
const APP_UTC_OFFSET_MS = (6 * 60 + 30) * 60 * 1000
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * Parse a stored timestamp as an absolute instant.
 *
 * Backend responses already carry an explicit UTC offset. Older records can be
 * timezone-naive; those are treated as UTC rather than as the browser's local
 * time, so the Yangon offset is only ever applied once, at display time.
 */
export function parseUtcTimestamp(
  value: string | null | undefined,
): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  let normalized = trimmed.replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized = `${normalized}T00:00:00`
  }
  if (!HAS_TIMEZONE.test(normalized)) {
    normalized = `${normalized}Z`
  }

  const date = new Date(normalized)
  return Number.isFinite(date.getTime()) ? date : null
}

function formatInYangon(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback: string,
): string {
  const date = parseUtcTimestamp(value)
  if (!date) return fallback
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(date)
}

export function formatAuditTimestamp(
  value: string | null | undefined,
): string {
  return formatInYangon(
    value,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
    'Timestamp unavailable',
  )
}

export function formatLongAuditTimestamp(
  value: string | null | undefined,
): string {
  return formatInYangon(
    value,
    { dateStyle: 'full', timeStyle: 'medium' },
    'Timestamp unavailable',
  )
}

export function formatShortDate(value: string | null | undefined): string {
  return formatInYangon(
    value,
    { month: 'short', day: 'numeric' },
    'Unknown',
  )
}

export function formatDateTime(value: string | null | undefined): string {
  return formatAuditTimestamp(value)
}

/** Calendar date key used for grouping activity in the application timezone. */
export function getYangonDayKey(
  value: string | null | undefined,
): string | null {
  const date = parseUtcTimestamp(value)
  if (!date) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  return year && month && day ? `${year}-${month}-${day}` : null
}

/** Convert a Yangon calendar-day filter value to a UTC query boundary. */
export function dateRangeUtcIso(
  value: string,
  endOfDay: boolean,
): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const wallClockAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  return new Date(wallClockAsUtc - APP_UTC_OFFSET_MS).toISOString()
}
