/**
 * Observation J5 sous flux (multi-salles, débit élevé), uniquement par
 * l'API — ce que voit un client, sans accès aux bases :
 *
 * 1. latence (p50/p95/max) et taille des réponses des lectures du mobile
 *    (liste des salles, alertes, dernière valeur, historique 24h) pendant
 *    que le simulateur publie ;
 * 2. délai de bout en bout : âge de la mesure la plus récente visible par
 *    l'API (publication → ingester → journal brut → worker → base vérifiée) ;
 * 3. bilan par salle à la fin : mesures consolidées pendant l'essai et
 *    alertes ouvertes/résolues — attendu : une seule alerte pour la salle en
 *    pic (`--co2-spike` du simulateur), aucune pour les autres.
 *
 * À lancer en parallèle du simulateur, voir docs/preuves/j5/README.md.
 * Usage : npx tsx scripts/load-check.ts --duration 150 --concurrency 8
 */
import { parseArgs } from 'node:util'

interface Sample {
  endpoint: string
  ms: number
  bytes: number
  status: number
}

interface Room {
  id: string
  name: string
}

interface Device {
  id: string
  name: string
}

interface RoomAlert {
  id: string
  deviceName: string
  measurementType: string
  reason: string
  triggerValue: number
  openedAt: string
  resolvedAt: string | null
  resolvedValue: number | null
  status: string
}

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:3000' },
    email: { type: 'string', default: 'demo@campify.local' },
    password: { type: 'string', default: 'campify-demo' },
    duration: { type: 'string', default: '150' },
    concurrency: { type: 'string', default: '8' }
  }
})

const API = values.api!
const DURATION_MS = Number(values.duration) * 1000
const CONCURRENCY = Number(values.concurrency)

async function call(token: string, path: string): Promise<{ status: number; body: string; ms: number }> {
  const started = performance.now()
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await response.text()
  return { status: response.status, body, ms: performance.now() - started }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function fmt(n: number, digits = 0): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—'
}

async function main(): Promise<void> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: values.email, password: values.password })
  })
  if (!login.ok) throw new Error(`login refusé (${login.status})`)
  const { token } = (await login.json()) as { token: string }

  const rooms = JSON.parse((await call(token, '/rooms')).body) as Room[]
  const devicesByRoom = new Map<string, Device[]>()
  for (const room of rooms) devicesByRoom.set(room.id, JSON.parse((await call(token, `/rooms/${room.id}/devices`)).body) as Device[])
  const allDevices = [...devicesByRoom.values()].flat()

  const startedAt = new Date()
  const deadline = Date.now() + DURATION_MS
  const samples: Sample[] = []
  const ages: number[] = []
  const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

  // Lectures du mobile, tirées au hasard en continu par CONCURRENCY clients.
  const reads: Array<() => [string, string]> = [
    () => ['GET /rooms', '/rooms'],
    () => ['GET /rooms/:id/alerts', `/rooms/${pick(rooms).id}/alerts`],
    () => ['GET /rooms/:id/measurements/latest', `/rooms/${pick(rooms).id}/measurements/latest`],
    () => ['GET /devices/:id/history?type=co2 (24h)', `/devices/${pick(allDevices).id}/history?type=co2`]
  ]

  console.error(`Essai de ${DURATION_MS / 1000}s, ${CONCURRENCY} clients, ${rooms.length} salles, ${allDevices.length} devices…`)

  const client = async () => {
    while (Date.now() < deadline) {
      const [endpoint, path] = pick(reads)()
      const r = await call(token, path)
      samples.push({ endpoint, ms: r.ms, bytes: Buffer.byteLength(r.body), status: r.status })
    }
  }

  // Âge de la dernière mesure visible par l'API, échantillonné toutes les 2 s.
  const freshness = async () => {
    while (Date.now() < deadline) {
      for (const room of rooms) {
        const latest = JSON.parse((await call(token, `/rooms/${room.id}/measurements/latest`)).body) as Array<{ timestamp: string }>
        if (latest.length > 0) ages.push(Date.now() - Math.max(...latest.map((m) => new Date(m.timestamp).getTime())))
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  await Promise.all([...Array.from({ length: CONCURRENCY }, client), freshness()])
  // Laisse le worker consolider la fin du flux avant le bilan.
  await new Promise((resolve) => setTimeout(resolve, 6000))

  const lines: string[] = []
  lines.push(`Essai du ${startedAt.toISOString()} — ${DURATION_MS / 1000} s, ${CONCURRENCY} clients en lecture, ${rooms.length} salles`)
  lines.push('')
  lines.push('| Lecture | Requêtes | Erreurs | p50 (ms) | p95 (ms) | max (ms) | Taille max (octets) |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const endpoint of [...new Set(samples.map((s) => s.endpoint))].sort()) {
    const own = samples.filter((s) => s.endpoint === endpoint)
    const ms = own.map((s) => s.ms).sort((a, b) => a - b)
    const errors = own.filter((s) => s.status >= 400).length
    lines.push(`| ${endpoint} | ${own.length} | ${errors} | ${fmt(percentile(ms, 50))} | ${fmt(percentile(ms, 95))} | ${fmt(ms[ms.length - 1])} | ${Math.max(...own.map((s) => s.bytes))} |`)
  }
  const sortedAges = [...ages].sort((a, b) => a - b)
  lines.push('')
  lines.push(
    `Délai publication → visible dans l'API (âge de la mesure la plus récente) : p50 ${fmt(percentile(sortedAges, 50) / 1000, 1)} s, ` +
      `p95 ${fmt(percentile(sortedAges, 95) / 1000, 1)} s, max ${fmt(sortedAges[sortedAges.length - 1] / 1000, 1)} s (${ages.length} relevés)`
  )

  lines.push('')
  lines.push('| Salle | Mesures CO₂ consolidées pendant l\'essai | Alertes ouvertes pendant l\'essai | Détail |')
  lines.push('|---|---|---|---|')
  const since = startedAt.toISOString()
  for (const room of rooms) {
    let consolidated = 0
    for (const device of devicesByRoom.get(room.id) ?? []) {
      const history = JSON.parse((await call(token, `/devices/${device.id}/history?type=co2&from=${since}`)).body) as { buckets: Array<{ count: number }> }
      consolidated += history.buckets.reduce((n, b) => n + b.count, 0)
    }
    const alerts = (JSON.parse((await call(token, `/rooms/${room.id}/alerts?status=all&from=${since}`)).body) as RoomAlert[]).filter(
      (a) => new Date(a.openedAt) >= startedAt
    )
    const detail = alerts
      .map((a) =>
        a.status === 'resolved'
          ? `${a.measurementType} ${a.reason} : ouverte à ${a.triggerValue} (${a.openedAt.slice(11, 19)}), résolue à ${a.resolvedValue} (${a.resolvedAt!.slice(11, 19)})`
          : `${a.measurementType} ${a.reason} : ouverte à ${a.triggerValue} (${a.openedAt.slice(11, 19)}), en cours`
      )
      .join(' ; ')
    lines.push(`| ${room.name} | ${consolidated} | ${alerts.length} | ${detail || '—'} |`)
  }

  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
