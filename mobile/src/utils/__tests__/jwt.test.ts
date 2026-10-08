import { canSendCommands, readRole } from '../jwt'

function fakeToken(payload: Record<string, unknown>): string {
  const encode = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('readRole', () => {
  it('lit le rôle du payload JWT', () => {
    expect(readRole(fakeToken({ sub: 'u1', role: 'OPERATOR' }))).toBe('OPERATOR')
    expect(readRole(fakeToken({ sub: 'u1', role: 'VIEWER' }))).toBe('VIEWER')
  })

  it('renvoie null pour un token illisible ou un rôle inconnu', () => {
    expect(readRole('pas-un-jwt')).toBeNull()
    expect(readRole(fakeToken({ sub: 'u1', role: 'ROOT' }))).toBeNull()
  })

  it('seuls ADMIN et OPERATOR peuvent envoyer des commandes', () => {
    expect(canSendCommands(fakeToken({ role: 'ADMIN' }))).toBe(true)
    expect(canSendCommands(fakeToken({ role: 'OPERATOR' }))).toBe(true)
    expect(canSendCommands(fakeToken({ role: 'VIEWER' }))).toBe(false)
    expect(canSendCommands('t')).toBe(false)
  })
})
