import type { SocketLike } from '../client'
import { encode, parseClientMessage, type ClientMessage, type ServerMessage } from '../protocol'

/** In-memory stand-in for a browser WebSocket. */
export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = []
  readyState = 0
  sent: ClientMessage[] = []
  closed = false
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }

  static factory = (url: string): SocketLike => new FakeSocket(url)
  static get last(): FakeSocket {
    return FakeSocket.all[FakeSocket.all.length - 1]
  }
  static reset(): void {
    FakeSocket.all = []
  }

  send(data: string): void {
    const m = parseClientMessage(data)
    if (!m) throw new Error(`client sent an invalid message: ${data}`)
    this.sent.push(m)
  }
  close(): void {
    this.closed = true
    this.readyState = 3
  }

  // --- server side ---
  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: encode(msg) })
  }
  drop(): void {
    this.readyState = 3
    this.onclose?.({})
  }
}
