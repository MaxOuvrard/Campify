import { test } from 'node:test'
import * as assert from 'node:assert'
import { AlertService } from '../../../src/domain/services/AlertService'
import { Measurement } from '../../../src/domain/entities/Measurement'
import { InMemoryAlertRepository } from '../../fakes/inMemoryRepositories'
import { FakeLogger } from '../../fakes/testDoubles'

let minute = 0
function co2(value: number, deviceId = 'd1'): Measurement {
  const timestamp = new Date(Date.UTC(2024, 0, 1, 0, minute++))
  return { id: `m${minute}`, deviceId, type: 'co2', value, unit: 'ppm', timestamp, receivedAt: timestamp, messageId: `msg-${minute}` }
}

function setup() {
  const alerts = new InMemoryAlertRepository()
  const logger = new FakeLogger()
  const service = new AlertService(alerts, logger, [{ type: 'co2', max: 1000, hysteresis: 100 }])
  return { alerts, logger, service }
}

test('opens, keeps, then resolves one alert across an incident, logging only the two transitions', async () => {
  const { alerts, logger, service } = setup()

  for (const value of [800, 1200, 1300, 1250, 950, 880, 700]) {
    const m = co2(value)
    await service.evaluate(m, m.messageId as string)
  }

  assert.equal(alerts.alerts.length, 1)
  const [alert] = alerts.alerts
  assert.equal(alert.triggerValue, 1200)
  assert.equal(alert.resolvedValue, 880)
  assert.ok(alert.resolvedAt)

  const alertLogs = logger.entries.filter((e) => e.meta?.eventType === 'alert')
  assert.deepStrictEqual(alertLogs.map((e) => e.meta?.status), ['opened', 'resolved'])
  assert.equal(alertLogs[0].meta?.eventId, alert.openedEventId)
  assert.equal(alertLogs[1].meta?.eventId, alert.resolvedEventId)
  assert.equal(alertLogs[0].meta?.alertId, alert.id)
})

test('a new incident after a resolution opens a new alert', async () => {
  const { alerts, service } = setup()

  for (const value of [1200, 800, 1100]) {
    const m = co2(value)
    await service.evaluate(m, m.messageId as string)
  }

  assert.equal(alerts.alerts.length, 2)
  assert.ok(alerts.alerts[0].resolvedAt)
  assert.equal(alerts.alerts[1].resolvedAt, null)
})

test('keeps alerts of different devices independent', async () => {
  const { alerts, service } = setup()

  for (const m of [co2(1200, 'device-a'), co2(1200, 'device-b'), co2(800, 'device-a')]) {
    await service.evaluate(m, m.messageId as string)
  }

  assert.equal(await alerts.findOpen('device-a', 'co2'), null)
  assert.ok(await alerts.findOpen('device-b', 'co2'))
})

test('ignores measurement types without a threshold', async () => {
  const { alerts, service } = setup()
  const m = { ...co2(5000), type: 'humidity' }

  await service.evaluate(m, 'msg-x')

  assert.equal(alerts.alerts.length, 0)
})
