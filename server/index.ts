/**
 * FlySim multiplayer sky server (one shared world): `npm run server`.
 *
 * Env:
 *   PORT             listen port (default 8787)
 *   ALLOWED_ORIGINS  comma-separated page origins allowed to connect; `*` matches any run of
 *                    host characters, e.g. https://flysim-*.vercel.app. Unset = any (set it in production)
 *   TRUST_PROXY      "1" to take the client IP from X-Forwarded-For (only behind a proxy that appends it)
 *
 * GET /healthz answers 200 for host health checks; everything else is the WebSocket.
 */

import { createServer, type Server } from 'node:http'
import { isIP } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { MAX_MESSAGE_BYTES, SERVER_TICK_HZ } from '../src/net/protocol'
import { SkyServer } from './SkyServer'

const PORT = Number(process.env.PORT ?? 8787)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
const HEARTBEAT_MS = 15_000
const MAX_CONNECTIONS = 2_000
const MAX_CONNECTIONS_PER_IP = 16
/** A client this far behind on reading its snapshots is dropped instead of buffering forever. */
const MAX_BUFFERED_BYTES = 256 * 1024

/**
 * The key the rate limits count by. Behind a trusted proxy, the address the
 * proxy appended (the RIGHTMOST X-Forwarded-For entry; anything left of it is
 * client-supplied). IPv6 is grouped by /64, since one host usually owns a /64.
 */
export function clientKey(remoteAddress: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string {
  const forwarded = trustProxy ? (forwardedFor ?? '').split(',').pop()?.trim() : undefined
  let ip = forwarded && isIP(forwarded) ? forwarded : (remoteAddress ?? '')
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7)
  if (isIP(ip) !== 6) return isIP(ip) === 4 ? ip : 'unknown'
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`
}

/**
 * Whether a page origin may connect. Patterns are exact origins, or contain `*`
 * standing for one or more host-name characters (letters, digits, hyphens, dots),
 * so `https://flysim-*.vercel.app` covers every Vercel preview but not other sites.
 */
export function originAllowed(origin: string | undefined, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true
  if (!origin) return false
  return patterns.some((p) => {
    if (!p.includes('*')) return p === origin
    const re = p
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[a-z0-9.-]+')
    return new RegExp(`^${re}$`, 'i').test(origin)
  })
}

export function startServer(port = PORT): {
  http: Server
  wss: WebSocketServer
  sky: SkyServer
  stop: () => Promise<void>
} {
  const sky = new SkyServer()
  const http = createServer((req, res) => {
    const ok = req.method === 'GET' && (req.url === '/healthz' || req.url === '/')
    res.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain' })
    res.end(ok ? 'ok' : 'not found')
  })
  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ origin }: { origin: string }) => originAllowed(origin, ALLOWED_ORIGINS),
  })
  http.listen(port)
  const alive = new WeakMap<WebSocket, boolean>()
  const perIp = new Map<string, number>()

  wss.on('connection', (ws, req) => {
    const forwarded = req.headers['x-forwarded-for']
    const ip = clientKey(req.socket.remoteAddress, Array.isArray(forwarded) ? forwarded.join(',') : forwarded, TRUST_PROXY)
    const count = perIp.get(ip) ?? 0
    if (wss.clients.size > MAX_CONNECTIONS || count >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1013, 'Server busy')
      return
    }
    perIp.set(ip, count + 1)
    const client = sky.connect(
      {
        send: (d) => {
          if (ws.readyState !== ws.OPEN) return
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) ws.terminate()
          else ws.send(d)
        },
        close: () => ws.close(),
      },
      ip,
    )
    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      client.onMessage(data.toString())
    })
    ws.on('close', () => {
      client.onClose()
      const n = (perIp.get(ip) ?? 1) - 1
      if (n <= 0) perIp.delete(ip)
      else perIp.set(ip, n)
    })
    ws.on('error', () => ws.terminate())
  })

  const tick = setInterval(() => {
    try {
      sky.tick()
    } catch (err) {
      console.error('tick failed', err)
    }
  }, 1000 / SERVER_TICK_HZ)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate()
        continue
      }
      alive.set(ws, false)
      ws.ping()
    }
  }, HEARTBEAT_MS)

  const stop = () =>
    new Promise<void>((resolve) => {
      clearInterval(tick)
      clearInterval(heartbeat)
      for (const ws of wss.clients) ws.terminate()
      wss.close(() => http.close(() => resolve()))
    })
  return { http, wss, sky, stop }
}

// Run when executed directly (not when imported by tests).
if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  if (ALLOWED_ORIGINS.length === 0 && process.env.NODE_ENV === 'production') {
    console.warn('ALLOWED_ORIGINS is not set: any website can connect to this server.')
  }
  const { http } = startServer()
  http.on('listening', () => console.log(`FlySim sky server listening on ws://localhost:${PORT}`))
}
