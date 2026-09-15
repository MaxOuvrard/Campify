import { Clock } from '../../src/domain/ports/Clock'
import { Logger } from '../../src/domain/ports/Logger'
import { MqttPublisher, OutgoingCommandMessage } from '../../src/domain/ports/MqttPublisher'

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
