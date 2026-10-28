/**
 * Reconstruit le parcours réel d'une commande à partir de son commandId
 * (J4, ADR 0014) : interroge Loki (logs de l'API, de l'ingester, du worker
 * et du simulateur) puis la base vérifiée, et affiche :
 *   1. la timeline chronologique, tous services confondus ;
 *   2. les étapes attendues, cochées ou non — la première non cochée est
 *      celle où la chaîne s'est interrompue ;
 *   3. l'état persisté de la commande.
 *
 * La réception HTTP initiale ne porte pas encore de commandId (il est créé
 * à la persistance) : elle est retrouvée via l'idempotencyKey que le log
 * `command accepted` porte avec le commandId.
 *
 * Usage : npm run trace:command -- <commandId> [--loki http://localhost:3100] [--since 24h]
 */
import 'dotenv/config'
import { parseArgs } from 'node:util'
import { PrismaClient } from '@prisma/client'

interface LogLine {
  ts: number
  service: string
  msg: string
  fields: Record<string, unknown>
}

const SERVICES_SELECTOR = '{compose_service=~"backend|ingester|worker|simulator"}'

function parseSince(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value)
  if (!match) throw new Error(`--since invalide : ${value} (ex. 30m, 24h, 2d)`)
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd']
  return Number(match[1]) * unit
}

async function queryLoki(lokiUrl: string, needle: string, sinceMs: number): Promise<LogLine[]> {
  const end = Date.now()
  const params = new URLSearchParams({
    query: `${SERVICES_SELECTOR} |= ${JSON.stringify(needle)}`,
    start: String((end - sinceMs) * 1_000_000),
    end: String(end * 1_000_000),
    limit: '5000',
    direction: 'forward'
  })
  const response = await fetch(`${lokiUrl}/loki/api/v1/query_range?${params.toString()}`)
  if (!response.ok) throw new Error(`Loki a répondu ${response.status} : ${await response.text()}`)
  const body = (await response.json()) as { data: { result: Array<{ values: Array<[string, string]> }> } }

  const lines: LogLine[] = []
  for (const stream of body.data.result) {
    for (const [tsNs, raw] of stream.values) {
      let fields: Record<string, unknown>
      try {
        fields = JSON.parse(raw) as Record<string, unknown>
      } catch {
        continue // ligne non JSON (ex. logs Fastify en texte) : hors parcours
      }
      lines.push({
        ts: typeof fields.time === 'number' ? fields.time : Math.floor(Number(tsNs) / 1_000_000),
        service: String(fields.service ?? '?'),
        msg: String(fields.msg ?? ''),
        fields
      })
    }
  }
  return lines
}

function formatTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23)
}

const DETAIL_KEYS = ['ackStatus', 'delivery', 'latencyMs', 'previousStatus', 'transitionApplied', 'idempotencyKey', 'error']

function details(fields: Record<string, unknown>): string {
  return DETAIL_KEYS.filter((k) => fields[k] !== undefined)
    .map((k) => `${k}=${typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : String(fields[k])}`)
    .join(' ')
}

interface Step {
  label: string
  done: (lines: LogLine[]) => boolean
  /** Ce qui s'est passé à la place, si l'étape n'est pas atteinte. */
  instead?: (lines: LogLine[]) => string | undefined
}

const has = (lines: LogLine[], pred: (l: LogLine) => boolean) => lines.some(pred)
const device = (l: LogLine) => l.service === 'device-simulator'

const STEPS: Step[] = [
  { label: 'Demande reçue par l\'API', done: (ls) => has(ls, (l) => l.msg === 'command request received') },
  { label: 'Commande persistée (PENDING)', done: (ls) => has(ls, (l) => l.msg === 'command accepted') },
  {
    label: 'Publiée sur MQTT, confirmée par le broker (SENT)',
    done: (ls) => has(ls, (l) => l.msg === 'command published'),
    instead: (ls) => ls.find((l) => l.msg === 'command not published' || l.msg === 'command publish unconfirmed')?.fields.reason as string | undefined
  },
  { label: 'Reçue par l\'objet', done: (ls) => has(ls, (l) => device(l) && l.msg === 'command received') },
  {
    label: 'Exécutée par l\'objet',
    done: (ls) => has(ls, (l) => device(l) && l.fields.status === 'executed'),
    instead: (ls) => {
      const other = ls.find((l) => device(l) && ['ignored', 'rejected', 'expired'].includes(String(l.fields.status)))
      return other ? `${String(other.fields.status)}${other.fields.reason ? ` (${String(other.fields.reason)})` : ''}` : undefined
    }
  },
  {
    label: 'ACK émis par l\'objet',
    done: (ls) => has(ls, (l) => device(l) && l.fields.status === 'ack_sent'),
    instead: (ls) => (has(ls, (l) => device(l) && l.fields.status === 'ack_dropped') ? 'ack_dropped (perte simulée)' : undefined)
  },
  { label: 'ACK reçu par le backend (ingester)', done: (ls) => has(ls, (l) => l.msg === 'command ack received') },
  {
    label: 'État mis à jour par l\'ACK (ACKNOWLEDGED / FAILED)',
    done: (ls) => has(ls, (l) => l.msg === 'command acknowledged by device'),
    instead: (ls) => {
      const other = ls.find((l) => ['late ack after timeout', 'duplicate ack ignored', 'failed to acknowledge command'].includes(l.msg))
      return other ? String(other.fields.reason) : undefined
    }
  }
]

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      loki: { type: 'string', default: process.env.LOKI_URL ?? 'http://localhost:3100' },
      since: { type: 'string', default: '24h' }
    }
  })
  const commandId = positionals[0]
  if (!commandId) {
    console.error('Usage : npm run trace:command -- <commandId> [--loki http://localhost:3100] [--since 24h]')
    process.exitCode = 1
    return
  }
  const sinceMs = parseSince(values.since!)

  const byCommand = await queryLoki(values.loki!, commandId, sinceMs)
  const keys = new Set(byCommand.map((l) => l.fields.idempotencyKey).filter((k): k is string => typeof k === 'string'))
  const byKey = (await Promise.all([...keys].map((k) => queryLoki(values.loki!, k, sinceMs)))).flat()

  const seen = new Set<string>()
  const lines = [...byCommand, ...byKey]
    .filter((l) => {
      const id = `${l.ts}|${l.service}|${l.msg}|${JSON.stringify(l.fields)}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .sort((a, b) => a.ts - b.ts)

  console.log(`\n=== Parcours de la commande ${commandId} (${lines.length} lignes de log) ===\n`)
  if (lines.length === 0) console.log('  (aucune ligne trouvée — commandId correct ? logs plus anciens que --since ?)')
  for (const l of lines) {
    const status = String(l.fields.status ?? '')
    const reason = l.fields.reason ? ` reason=${String(l.fields.reason)}` : ''
    console.log(`  ${formatTime(l.ts)}  ${l.service.padEnd(17)} ${l.msg.padEnd(58)} ${status}${reason}  ${details(l.fields)}`.trimEnd())
  }

  console.log('\n=== Étapes ===\n')
  let firstMissing: string | null = null
  for (const step of STEPS) {
    const done = step.done(lines)
    const instead = done ? undefined : step.instead?.(lines)
    if (!done && firstMissing === null) firstMissing = step.label
    console.log(`  [${done ? 'x' : ' '}] ${step.label}${instead ? `  → à la place : ${instead}` : ''}`)
  }
  const timeout = lines.find((l) => l.msg === 'command timed out')
  if (timeout) console.log(`\n  Timeout déclaré par ${timeout.service} à ${formatTime(timeout.ts)} (reason=${String(timeout.fields.reason)})`)
  console.log(firstMissing ? `\n  → Chaîne interrompue à l'étape : « ${firstMissing} »` : '\n  → Parcours complet.')

  console.log('\n=== État persisté (base vérifiée) ===\n')
  const prisma = new PrismaClient()
  try {
    const row = await prisma.command.findUnique({ where: { id: commandId } })
    if (row === null) {
      console.log('  (commande introuvable en base)')
    } else {
      const { status, type, params, createdAt, expiresAt, sentAt, ackedAt, timedOutAt, failureReason, reportedState, lateAckStatus, lateAckAt } = row
      console.log(
        JSON.stringify({ status, type, params, createdAt, expiresAt, sentAt, ackedAt, timedOutAt, failureReason, reportedState, lateAckStatus, lateAckAt }, null, 2)
          .split('\n')
          .map((s) => `  ${s}`)
          .join('\n')
      )
    }
  } catch (err) {
    console.log(`  (base injoignable : ${(err as Error).message.split('\n')[0]})`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
