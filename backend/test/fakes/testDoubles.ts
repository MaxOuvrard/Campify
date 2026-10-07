import { Clock } from '../../src/domain/ports/Clock'
import { Logger } from '../../src/domain/ports/Logger'
import { MqttPublisher, OutgoingCommandMessage } from '../../src/domain/ports/MqttPublisher'
import { RawEventRepository } from '../../src/domain/ports/RawEventRepository'
import { ConsolidationCheckpointRepository } from '../../src/domain/ports/ConsolidationCheckpointRepository'
import { DeadLetterRepository } from '../../src/domain/ports/DeadLetterRepository'
import { DeadLetter, NewRawEvent, RawEvent, RawEventCursor } from '../../src/domain/entities/RawEvent'

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  msg: string
  meta?: Record<string, unknown>
}

export class FakeLogger implements Logger {
  readonly entries: LogEntry[] = []

  info(msg: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', msg, meta })
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', msg, meta })
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', msg, meta })
  }
}

export class FakeMqttPublisher implements MqttPublisher {
  readonly published: OutgoingCommandMessage[] = []

  async publishCommand(message: OutgoingCommandMessage): Promise<void> {
    this.published.push(message)
  }
}

export class FakeRawEventRepository implements RawEventRepository {
  readonly events: RawEvent[] = []
  failNext = false

  async record(event: NewRawEvent): Promise<RawEvent> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('raw store unavailable')
    }
    const raw: RawEvent = {
      id: String(this.events.length + 1).padStart(24, '0'),
      topic: event.topic,
      payload: event.payload,
      qos: event.qos,
      retain: event.retain,
      receivedAt: event.receivedAt ?? new Date(Date.now() - 10_000)
    }
    this.events.push(raw)
    return raw
  }

  async findAfter(cursor: RawEventCursor | null, limit: number, receivedBefore: Date): Promise<RawEvent[]> {
    return this.sorted()
      .filter((e) => e.receivedAt < receivedBefore && isAfter(e, cursor))
      .slice(0, limit)
  }

  async countAfter(cursor: RawEventCursor | null): Promise<number> {
    return this.events.filter((e) => isAfter(e, cursor)).length
  }

  private sorted(): RawEvent[] {
    return [...this.events].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id))
  }
}

function isAfter(event: RawEvent, cursor: RawEventCursor | null): boolean {
  if (cursor === null) return true
  const diff = event.receivedAt.getTime() - cursor.receivedAt.getTime()
  return diff > 0 || (diff === 0 && event.id > cursor.id)
}

export class FakeCheckpointRepository implements ConsolidationCheckpointRepository {
  readonly cursors = new Map<string, RawEventCursor>()

  async load(consumer: string): Promise<RawEventCursor | null> {
    return this.cursors.get(consumer) ?? null
  }

  async save(consumer: string, cursor: RawEventCursor): Promise<void> {
    this.cursors.set(consumer, cursor)
  }
}

export class FakeDeadLetterRepository implements DeadLetterRepository {
  readonly deadLetters: DeadLetter[] = []

  async record(deadLetter: DeadLetter): Promise<void> {
    this.deadLetters.push(deadLetter)
  }
}
