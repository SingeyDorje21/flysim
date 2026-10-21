import { describe, expect, it } from 'vitest'
import {
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatStat,
  formatTime,
  formatVerticalSpeed,
} from '../format'

describe('format', () => {
  it('formats speed', () => {
    expect(formatSpeed(50, 'imperial')).toBe('97 kt')
    expect(formatSpeed(50, 'metric')).toBe('180 km/h')
    expect(formatSpeed(NaN, 'metric')).toBe('0 km/h')
  })
  it('formats altitude', () => {
    expect(formatAltitude(1000, 'imperial')).toBe('3,281 ft')
    expect(formatAltitude(1000, 'metric')).toBe('1,000 m')
  })
  it('formats vertical speed with sign', () => {
    expect(formatVerticalSpeed(2.54, 'imperial')).toBe('+500 ft/min')
    expect(formatVerticalSpeed(-2.54, 'imperial')).toBe('-500 ft/min')
    expect(formatVerticalSpeed(2.54, 'metric')).toBe('+2.5 m/s')
    expect(formatVerticalSpeed(-2.54, 'metric')).toBe('-2.5 m/s')
    expect(formatVerticalSpeed(0, 'metric')).toBe('0.0 m/s')
  })
  it('formats distance', () => {
    expect(formatDistance(300, 'imperial')).toBe('984 ft')
    expect(formatDistance(3704, 'imperial')).toBe('2.0 nm')
    expect(formatDistance(300, 'metric')).toBe('300 m')
    expect(formatDistance(2500, 'metric')).toBe('2.5 km')
  })
  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65.9)).toBe('1:05')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(-5)).toBe('0:00')
  })
  it('formats stats by kind', () => {
    expect(formatStat({ label: 'a', value: 50, kind: 'speed' }, 'imperial')).toBe('97 kt')
    expect(formatStat({ label: 'a', value: 100, kind: 'altitude' }, 'metric')).toBe('100 m')
    expect(formatStat({ label: 'a', value: 100, kind: 'distance' }, 'metric')).toBe('100 m')
    expect(formatStat({ label: 'a', value: -2.54, kind: 'verticalSpeed' }, 'imperial')).toBe('-500 ft/min')
    expect(formatStat({ label: 'a', value: 90, kind: 'time' }, 'metric')).toBe('1:30')
    expect(formatStat({ label: 'a', value: 1.84, kind: 'g' }, 'metric')).toBe('1.8 G')
    expect(formatStat({ label: 'a', value: 12.34, kind: 'degrees' }, 'metric')).toBe('12.3°')
    expect(formatStat({ label: 'a', value: 7, kind: 'count' }, 'metric')).toBe('7')
    expect(formatStat({ label: 'a', value: 1234, kind: 'score' }, 'metric')).toBe('1,234')
  })
})
