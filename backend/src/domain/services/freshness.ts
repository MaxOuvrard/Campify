export function isFresh(lastSeenAt: Date | null, now: Date, thresholdMs: number): boolean {
  if (lastSeenAt === null) return false
  return now.getTime() - lastSeenAt.getTime() <= thresholdMs
}
