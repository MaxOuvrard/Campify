# Preuve — lisibilité, contraste et accessibilité de l'app mobile (J5)

Jalon J5 : « Vérifier lisibilité, contraste, libellés et gestion des erreurs ».

## Reproduire

```bash
cd mobile
npm ci
npx jest src/theme src/screens/__tests__/accessibility.test.tsx
```

- `src/theme/__tests__/colors.test.ts` : chaque couleur de texte de la
  palette (`src/theme/colors.ts`) contre chaque fond, seuil WCAG AA 4.5:1,
  et aucun écran n'utilise de couleur de texte en dur hors palette.
- `src/screens/__tests__/accessibility.test.tsx` : ce que perçoit un lecteur
  d'écran — boutons trouvés par rôle et nom, erreurs avec le rôle `alert`,
  champs libellés, état replié/déplié annoncé.

Vérifié : remettre `#888` en dur dans un écran, ou passer `textMuted` à
`#999999`, fait échouer 7 tests.

## Contraste avant / après

Ratios WCAG 2.1 (`src/theme/contrast.ts`), minimum AA 4.5:1.

| Élément | Avant | Ratio | Après | Ratio |
|---|---|---|---|---|
| Dates, « Données du… », min/max (sur blanc) | `#888` | 3.54 ❌ | `textMuted #5f6368` | 6.05 |
| Mêmes textes sur carte `#f4f6f8` | `#888` | 3.27 ❌ | `textMuted` | 5.58 |
| Astuce sous le graphique | `#aaa` | 2.32 ❌ | `textMuted` | 6.05 |
| Colonne « capteur silencieux » | `opacity: 0.75` sur tout le texte | < 3 ❌ | fond `#eef0f3`, opacité 1 | ≥ 4.53 |
| Placeholders de saisie | gris système | ≈ 2.5–3 ❌ | `textMuted` | 6.05 |
| Labels (`#555`, `#666`) | | 5.3–6.9 ✅ | `textSecondary #4b5563` | 6.6–7.6 |
| Texte blanc sur boutons / badges | | 5.17–6.47 ✅ | inchangé | 5.17–6.47 |

Seule exception : le fond du bouton « Valider » désactivé (`#a5b4d8`), exempté
par WCAG 1.4.3 (composant inactif) ; son état est annoncé
(`accessibilityState.disabled`).

## Tailles de texte

Minimum 12 px partout (avant : graduations du graphique à 10 px, astuces,
badges et « Voir l'historique › » à 11 px).

## Lecteur d'écran (TalkBack / VoiceOver)

Avant : aucun `accessibilityRole` ni `accessibilityLabel` dans l'app.

| Élément | Annoncé avant | Annoncé après |
|---|---|---|
| `< Salles` | « inférieur à Salles » | « Retour aux salles, bouton » |
| Ligne de salle | « Salle B » (badges ignorés ou lus avec l'emoji) | « Salle B, 2 alertes en cours, capteur silencieux, bouton » |
| Métrique | trois textes séparés | « CO₂ 1250 ppm, en alerte, bouton — ouvre l'historique » |
| Carte d'alerte | textes séparés, emoji lu | « Alerte : CO₂ trop élevé, Capteur 1, 1250 ppm, seuil 1000 ppm, en cours depuis le … » |
| Barre du graphique | rien | « 14:05 : 812 ppm, bouton » |
| Erreurs et bandeaux | pas annoncés à leur apparition | rôle `alert` + `accessibilityLiveRegion="polite"` |
| Champs de connexion | placeholder seul (disparaît à la saisie) | libellé visible + `accessibilityLabel` |
| Bouton « Se connecter » pendant l'appel | rien | `accessibilityState.busy` |
| « Revenues à la normale » | | état `expanded` annoncé |

Défaut trouvé par les tests pendant ce travail : un `View` avec
`accessibilityRole="alert"` mais sans `accessible` n'est pas un élément pour
le lecteur d'écran — le rôle était ignoré. Corrigé sur tous les bandeaux.

## Limites

- Vérifié par tests automatisés (arbre d'accessibilité React Native), pas
  par une session TalkBack/VoiceOver sur un vrai téléphone.
- Pas de prise en charge du mode sombre ni de la taille de police système
  au-delà du comportement par défaut de React Native (`allowFontScaling`
  actif, mise en page non testée à 200 %).
