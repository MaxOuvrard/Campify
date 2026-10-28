export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER'

/**
 * Lit le rôle dans le payload du JWT, SANS vérifier la signature : sert
 * uniquement au confort d'affichage (masquer des boutons inutilisables).
 * La vraie protection reste le RBAC du backend (403).
 */
export function readRole(token: string): Role | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const decoded = JSON.parse(atob(base64)) as { role?: unknown }
    return decoded.role === 'ADMIN' || decoded.role === 'OPERATOR' || decoded.role === 'VIEWER' ? decoded.role : null
  } catch {
    return null
  }
}

export function canSendCommands(token: string): boolean {
  const role = readRole(token)
  return role === 'ADMIN' || role === 'OPERATOR'
}
