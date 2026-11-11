import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'

/**
 * Egress gate for Savespace's bundled AI engine. The engine is started with HTTPS_PROXY pointing
 * here, so EVERY outbound connection it makes passes through this gate:
 *  - allowed only while Savespace is downloading a model (the user's selected model), and
 *  - only to Ollama's model registry and its blob storage, port 443 (TLS end-to-end; not inspected).
 * Everything else (update checks, "model recommendations", cloud features, anything new) is refused
 * and reported, so the engine can never phone home on its own.
 */
export const EGRESS_ALLOWED_HOSTS: RegExp[] = [
  /^registry\.ollama\.ai$/,
  /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/,
]

export function egressAllowed(target: string, downloading: boolean): boolean {
  const m = /^([a-z0-9.-]+):(\d+)$/i.exec(target)
  if (!m || m[2] !== '443' || !downloading) return false
  return EGRESS_ALLOWED_HOSTS.some((re) => re.test(m[1]!.toLowerCase()))
}

export class EgressGate {
  port: number | null = null
  private server: Server | null = null
  private downloads = 0
  private sockets = new Set<Socket>()

  constructor(private readonly onBlocked: (target: string) => void = () => {}) {}

  async start(): Promise<number> {
    if (this.port) return this.port
    const server = createServer((req, res) => {
      // Plain-HTTP proxying is never needed (the registry is HTTPS-only).
      this.onBlocked(`http ${req.headers.host ?? '?'}`)
      res.writeHead(403).end()
    })
    server.on('connect', (req, client: Socket, head: Buffer) => {
      const target = req.url ?? ''
      if (!egressAllowed(target, this.downloads > 0)) {
        this.onBlocked(target)
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      const [host, port] = target.split(':')
      const upstream = connect(Number(port), host!, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      for (const s of [client, upstream]) {
        this.sockets.add(s)
        s.on('close', () => this.sockets.delete(s))
        s.on('error', () => {
          client.destroy()
          upstream.destroy()
        })
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as { port: number }).port
    return this.port
  }

  /** Opens the gate (registry hosts only) for the duration of `fn`. */
  async whileDownloading<T>(fn: () => Promise<T>): Promise<T> {
    this.downloads++
    try {
      return await fn()
    } finally {
      this.downloads--
      if (this.downloads === 0) for (const s of this.sockets) s.destroy()
    }
  }

  stop(): void {
    for (const s of this.sockets) s.destroy()
    this.server?.close()
    this.server = null
    this.port = null
  }
}
