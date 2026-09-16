import { Clock } from '../../src/domain/ports/Clock'
import { Logger } from '../../src/domain/ports/Logger'
import { MqttPublisher, OutgoingCommandMessage } from '../../src/domain/ports/MqttPublisher'
import { RawMeasurementRepository } from '../../src/domain/ports/RawMeasurementRepository'
import { NewMeasurement } from '../../src/domain/entities/Measurement'
import { RawMeasurement } from '../../src/domain/entities/RawMeasurement'
import { randomUUID } from 'node:crypto'

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

export class FakeRawMeasurementRepository implements RawMeasurementRepository {
  readonly recorded: RawMeasurement[] = []
  failNext = false
  vanishOnReadBack = false

  async record(input: NewMeasurement): Promise<RawMeasurement> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('raw store unavailable')
    }
    const raw: RawMeasurement = {
      id: randomUUID(),
      deviceId: input.deviceId,
      type: input.type,
      value: input.value,
      unit: input.unit ?? null,
      timestamp: input.timestamp,
      messageId: input.messageId ?? null,
      receivedAt: new Date()
    }
    this.recorded.push(raw)
    return raw
  }

  async findById(id: string): Promise<RawMeasurement | null> {
    if (this.vanishOnReadBack) return null
    return this.recorded.find((r) => r.id === id) ?? null
  }
}
