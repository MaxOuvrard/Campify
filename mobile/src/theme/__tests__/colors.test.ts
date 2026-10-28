import { filled, onFilled, surfaces, textColors } from '../colors'
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from '../contrast'
import { TONE_COLORS } from '../../components/DeviceCommandPanel'

describe('contrastRatio', () => {
  it('calcule les valeurs de référence WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // Ancien gris des dates : sous le seuil AA, d'où son remplacement.
    expect(contrastRatio('#888888', '#ffffff')).toBeLessThan(WCAG_AA_NORMAL_TEXT)
  })
})

describe('palette — contraste WCAG AA (≥ 4.5:1)', () => {
  const textOnSurfaces = Object.entries(textColors).flatMap(([text, fg]) =>
    Object.entries(surfaces).map(([surface, bg]) => [text, surface, fg, bg] as const)
  )
  const onFilledBackgrounds = Object.entries(onFilled).flatMap(([text, fg]) =>
    Object.entries(filled).map(([fill, bg]) => [text, fill, fg, bg] as const)
  )

  // Statuts de commande (DeviceCommandPanel) : chaque teinte a son propre fond.
  const commandTones = Object.entries(TONE_COLORS).map(([tone, { text, background }]) => [`statut ${tone}`, 'son fond', text, background] as const)

  it.each([...textOnSurfaces, ...onFilledBackgrounds, ...commandTones])('%s sur %s', (_text, _bg, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
  })
})

// Pas de @types/node dans l'app : typage minimal des deux modules Node lus ici.
declare const __dirname: string
const fs = jest.requireActual<{ readdirSync(dir: string): string[]; readFileSync(file: string, encoding: 'utf8'): string }>('fs')
const path = jest.requireActual<{ join(...parts: string[]): string }>('path')

describe('écrans et composants — aucune couleur de texte hors palette', () => {
  const dirs = ['screens', 'components'].map((dir) => path.join(__dirname, '..', '..', dir))
  const files = dirs.flatMap((dir) => fs.readdirSync(dir).filter((f: string) => f.endsWith('.tsx')).map((f: string) => path.join(dir, f)))

  it.each(files)('%s', (file: string) => {
    const source = fs.readFileSync(file, 'utf8')
    // `color: '#…'` (texte) ou `color="#…"` (prop) : doivent passer par `colors.*`,
    // sinon la couleur échappe au contrôle de contraste ci-dessus.
    const hardcoded = source.match(/(?<![A-Za-z])color(?::\s*|=)['"]#[0-9a-fA-F]{3,8}['"]/g) ?? []
    expect(hardcoded).toEqual([])
  })
})
