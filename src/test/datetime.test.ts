import { describe, expect, it } from 'vitest'
import {
  APP_TIME_ZONE,
  dateRangeUtcIso,
  formatAuditTimestamp,
  formatLongAuditTimestamp,
  formatShortDate,
  getYangonDayKey,
  parseUtcTimestamp,
} from '../utils/datetime'

describe('Asia/Yangon timestamp handling', () => {
  it('treats timezone-naive stored timestamps as UTC', () => {
    expect(parseUtcTimestamp('2026-11-19T17:39:00')?.toISOString()).toBe(
      '2026-11-19T17:39:00.000Z',
    )
    expect(parseUtcTimestamp('2026-11-19 17:39:00')?.toISOString()).toBe(
      '2026-11-19T17:39:00.000Z',
    )
  })

  it('formats explicit UTC instants without applying the offset twice', () => {
    expect(APP_TIME_ZONE).toBe('Asia/Yangon')
    expect(formatAuditTimestamp('2026-11-19T17:39:00Z')).toBe(
      'Nov 20, 2026, 12:09 AM',
    )
    expect(formatAuditTimestamp('2026-11-19T11:39:00+00:00')).toBe(
      'Nov 19, 2026, 6:09 PM',
    )
  })

  it('uses Yangon dates for detail text and dashboard day grouping', () => {
    expect(formatLongAuditTimestamp('2026-11-19T17:39:00Z')).toBe(
      'Friday, November 20, 2026 at 12:09:00 AM',
    )
    expect(formatShortDate('2026-11-19T17:39:00Z')).toBe('Nov 20')
    expect(getYangonDayKey('2026-11-19T17:39:00Z')).toBe('2026-11-20')
  })

  it('converts Yangon date-filter inputs to UTC query boundaries', () => {
    expect(dateRangeUtcIso('2026-11-19', false)).toBe(
      '2026-11-18T17:30:00.000Z',
    )
    expect(dateRangeUtcIso('2026-11-19', true)).toBe(
      '2026-11-19T17:29:59.999Z',
    )
  })
})
