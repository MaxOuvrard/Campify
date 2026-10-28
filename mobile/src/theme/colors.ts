/**
 * Palette unique de l'app. Toute couleur de texte d'un écran vient d'ici :
 * `src/theme/__tests__/colors.test.ts` vérifie que chaque couleur de
 * `textColors` atteint le contraste WCAG AA (4.5:1) sur chaque fond de
 * `surfaces`, et chaque couleur de `onFilled` sur chaque fond de `filled` —
 * et qu'aucun écran n'utilise de couleur de texte en dur hors palette.
 */
export const surfaces = {
  background: '#ffffff',
  surface: '#f4f6f8',
  dangerSurface: '#fef2f2',
  silentSurface: '#fdf2f2',
  warningSurface: '#fef3c7',
  staleSurface: '#eef0f3'
} as const

export const textColors = {
  text: '#1f2937',
  textSecondary: '#4b5563',
  textMuted: '#5f6368',
  link: '#2563eb',
  danger: '#c0392b',
  dangerStrong: '#991b1b',
  warning: '#92400e',
  success: '#166534'
} as const

/** Fonds pleins (boutons, badges) et texte posé dessus. */
export const filled = {
  primary: '#2563eb',
  danger: '#c0392b',
  alert: '#b91c1c'
} as const

export const onFilled = {
  onFilled: '#ffffff'
} as const

/** Traits et bordures décoratifs : pas de texte dessus, hors contrôle de contraste. */
export const lines = {
  border: '#cccccc',
  divider: '#e2e5e9',
  separator: '#eeeeee'
} as const

export const colors = { ...surfaces, ...textColors, ...lines, ...onFilled, filledPrimary: filled.primary, filledDanger: filled.danger, filledAlert: filled.alert }
