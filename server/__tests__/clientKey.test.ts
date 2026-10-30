import { describe, expect, it } from 'vitest'
import { clientKey } from '../index'

describe('clientKey', () => {
  it('uses the socket address when no proxy is trusted', () => {
    expect(clientKey('203.0.113.7', '1.2.3.4', false)).toBe('203.0.113.7')
  })

  it('behind a trusted proxy takes the rightmost (proxy-appended) X-Forwarded-For entry', () => {
    expect(clientKey('10.0.0.1', '6.6.6.6, 203.0.113.7', true)).toBe('203.0.113.7')
  })

  it('ignores a forwarded value that is not an IP', () => {
    expect(clientKey('10.0.0.1', 'evil, not-an-ip', true)).toBe('10.0.0.1')
  })

  it('unwraps IPv4-mapped IPv6', () => {
    expect(clientKey('::ffff:203.0.113.7', undefined, false)).toBe('203.0.113.7')
  })

  it('groups IPv6 addresses by /64', () => {
    const a = clientKey('2001:db8:1:2:aaaa::1', undefined, false)
    const b = clientKey('2001:0db8:0001:0002:ffff:1:2:3', undefined, false)
    expect(a).toBe('2001:db8:1:2::/64')
    expect(b).toBe(a)
    expect(clientKey('2001:db8::1', undefined, false)).toBe('2001:db8:0:0::/64')
  })

  it('falls back to a shared key for garbage', () => {
    expect(clientKey(undefined, undefined, false)).toBe('unknown')
  })
})
