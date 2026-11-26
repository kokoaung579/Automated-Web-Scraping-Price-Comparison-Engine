import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_TIME_ZONE,
  dateRangeUtcIso,
  formatAppDayKey,
  formatAuditTimestamp,
  formatLongAuditTimestamp,
  formatShortDate,
  getRecentAppDayKeys,
  getYangonDayKey,
  parseAppTimeZoneInputValue,
  parseUtcTimestamp,
  setAppTimeZone,
  toAppTimeZoneInputValue,
} from '../utils/datetime'

describe('Asia/Yangon timestamp handling', () => {
  afterEach(() => {
    setAppTimeZone(APP_TIME_ZONE)
  })

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

  it('round-trips schedule inputs through the app timezone exactly once', () => {
    setAppTimeZone(APP_TIME_ZONE)
    const utc = '2026-11-19T17:30:00.000Z'
    expect(toAppTimeZoneInputValue(utc)).toBe('2026-11-20T00:00')
    expect(parseAppTimeZoneInputValue('2026-11-20T00:00')).toBe(utc)
    expect(parseAppTimeZoneInputValue('not-a-date')).toBeNull()
  })

  it('builds trailing calendar-day keys ending on the app-timezone today', () => {
    const now = new Date('2026-11-20T17:29:00.000Z')
    expect(getRecentAppDayKeys(7, now)).toEqual([
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ])
    expect(getRecentAppDayKeys(30, now)).toHaveLength(30)
    expect(getRecentAppDayKeys(90, now)).toHaveLength(90)
  })

  it('keeps the same calendar day near midnight in the configured timezone', () => {
    setAppTimeZone('Pacific/Kiritimati')
    const keys = getRecentAppDayKeys(
      7,
      new Date('2026-11-19T09:30:00.000Z'),
    )
    expect(keys.at(-1)).toBe('2026-11-19')
    expect(keys.at(0)).toBe('2026-11-13')
    expect(formatAppDayKey('2026-11-19')).toBe('Nov 19')
  })

  it('labels calendar-day keys in the configured timezone without a UTC shift', () => {
    expect(formatAppDayKey('2026-11-20')).toBe('Nov 20')
    setAppTimeZone('Pacific/Kiritimati')
    expect(formatAppDayKey('2026-11-20')).toBe('Nov 20')
    setAppTimeZone('Pacific/Honolulu')
    expect(formatAppDayKey('2026-11-20')).toBe('Nov 20')
    expect(formatAppDayKey('not-a-day')).toBe('Unknown')
  })
})
