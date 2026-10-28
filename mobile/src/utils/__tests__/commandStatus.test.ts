import { Command } from '../../api/client'
import { describeCommand, isOpen } from '../commandStatus'

function command(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1',
    deviceId: 'sensor-001',
    type: 'set_ventilation',
    params: { on: true },
    status: 'SENT',
    createdAt: '2026-10-08T10:00:00.000Z',
    expiresAt: '2026-10-08T10:00:15.000Z',
    sentAt: '2026-10-08T10:00:00.050Z',
    ackedAt: null,
    timedOutAt: null,
    failureReason: null,
    reportedState: null,
    lateAck: null,
    ...overrides
  }
}

describe('describeCommand — dire exactement ce que le système sait', () => {
  it('PENDING et SENT sont des attentes, jamais présentées comme réussies', () => {
    for (const status of ['PENDING', 'SENT'] as const) {
      const d = describeCommand(command({ status }))
      expect(d.tone).toBe('pending')
      expect(d.title).not.toMatch(/✓|allumée/i)
    }
    expect(describeCommand(command({ status: 'SENT' })).title).toMatch(/En attente de confirmation de l'objet/)
  })

  it("ACKNOWLEDGED affiche l'état rapporté par l'objet", () => {
    const d = describeCommand(command({ status: 'ACKNOWLEDGED', ackedAt: '2026-10-08T10:00:01.000Z', reportedState: { ventilation: 'on' } }))
    expect(d.tone).toBe('success')
    expect(d.title).toBe('✓ Ventilation allumée')
    expect(d.detail).toMatch(/Confirmé par l'objet/)
  })

  it("l'état confirmé vient de l'objet, pas de la demande", () => {
    // Demande « allumer » mais l'objet rapporte « off » : on affiche ce que dit l'objet.
    const d = describeCommand(command({ status: 'ACKNOWLEDGED', ackedAt: '2026-10-08T10:00:01.000Z', reportedState: { ventilation: 'off' } }))
    expect(d.title).toBe('✓ Ventilation éteinte')
  })

  it.each([
    ['broker_unavailable', /rien n'a été envoyé/],
    ['expired_on_device', /trop tard/],
    ['rejected_by_device: fan_jammed', /refusé/]
  ])('FAILED (%s) explique pourquoi', (reason, expected) => {
    const d = describeCommand(command({ status: 'FAILED', failureReason: reason }))
    expect(d.tone).toBe('error')
    expect(d.detail).toMatch(expected)
  })

  it("TIMEOUT n'est pas présenté comme un échec : l'état réel est inconnu", () => {
    const d = describeCommand(command({ status: 'TIMEOUT', timedOutAt: '2026-10-08T10:00:20.000Z' }))
    expect(d.tone).toBe('unknown')
    expect(`${d.title} ${d.detail}`).not.toMatch(/échec/i)
    expect(d.detail).toMatch(/inconnu/)
  })

  it('TIMEOUT avec ACK tardif le signale explicitement', () => {
    const d = describeCommand(command({ status: 'TIMEOUT', lateAck: { status: 'executed', at: '2026-10-08T10:00:25.000Z' } }))
    expect(d.tone).toBe('unknown')
    expect(d.detail).toMatch(/finalement répondu après le délai : commande exécutée/)
  })

  it('isOpen ne vaut que pour PENDING et SENT', () => {
    expect(isOpen(command({ status: 'PENDING' }))).toBe(true)
    expect(isOpen(command({ status: 'SENT' }))).toBe(true)
    expect(isOpen(command({ status: 'ACKNOWLEDGED' }))).toBe(false)
    expect(isOpen(command({ status: 'TIMEOUT' }))).toBe(false)
  })
})
