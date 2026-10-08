/**
 * Clé d'idempotence d'une demande de commande (UUID v4). Une par appui de
 * l'utilisateur, réutilisée telle quelle pour les nouveaux essais réseau de
 * ce même appui — voir docs/decisions/0014-cycle-de-vie-des-commandes.md.
 *
 * Générée sans dépendance : l'unicité n'est exigée que par utilisateur (la
 * contrainte backend est `(requestedBy, idempotencyKey)`), Math.random
 * suffit largement à ce volume. `crypto.randomUUID` est préféré s'il existe.
 */
export function generateIdempotencyKey(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID
  if (typeof native === 'function') return native.call((globalThis as { crypto: unknown }).crypto)

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
