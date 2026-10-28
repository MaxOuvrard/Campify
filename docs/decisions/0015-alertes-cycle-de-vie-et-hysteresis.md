# ADR 0015 — Alertes avec cycle de vie (ouverture / retour à la normale) et hystérésis

## Statut

Acceptée.

## Contexte

Jusqu'ici, `domain/services/alerts.ts` (`evaluateAlerts`) était sans état :
chaque mesure acceptée au-delà d'un seuil produisait une ligne de log
`threshold alert`. Un capteur CO2 à 1200 ppm publiant toutes les 10 s
générait donc 360 « alertes » par heure pour un seul incident, et rien ne
signalait le retour à la normale. Les seuils (`alertThresholds` dans
`composition.ts`) étaient en outre vides : aucune alerte ne se déclenchait.

J5 demande une règle d'alerte documentée, avec activation et retour à la
normale, qui ne se multiplie pas à chaque mesure.

## Décision

Une alerte est un **objet persistant avec un cycle de vie**, porté par un
couple (device, type de mesure) — table `Alert` dans la base vérifiée,
port `AlertRepository`.

Règle (fonction pure `decideAlertTransition`, `domain/services/alerts.ts`),
évaluée par `AlertService` sur chaque mesure **acceptée** par la
consolidation :

| Alerte ouverte ? | Valeur | Transition |
|---|---|---|
| non | dans les bornes | `none` |
| non | `> max` ou `< min` | `open` (une ligne de log `status: opened`) |
| oui | toujours hors seuil, ou dans la marge d'hystérésis | `ongoing` : met à jour `lastValue`/`lastSeenAt`, **aucune nouvelle alerte, aucun log** |
| oui | revenue au-delà de la marge (`<= max - h` / `>= min + h`) | `resolve` (une ligne de log `status: resolved`) |
| oui | franchit le seuil opposé d'un coup | `resolve` puis `open` |

Seuils retenus (`composition.ts`) :

| Type | Ouverture | Retour à la normale |
|---|---|---|
| `co2` | > 1000 ppm | ≤ 900 ppm |
| `temperature` | > 28 °C ou < 16 °C | ≤ 27 °C / ≥ 17 °C |

Garanties :

- **Au plus une alerte ouverte par (device, type)** : appliquée par la règle,
  et par la base — colonne `openKey` unique, valant `"deviceId:type"` tant
  que l'alerte est ouverte et `NULL` une fois résolue (PostgreSQL accepte
  plusieurs `NULL` dans une colonne unique). Équivalent d'un index unique
  partiel `WHERE resolvedAt IS NULL`, que Prisma 6 ne sait pas déclarer ;
  un index créé en SQL hors schéma serait supprimé par le prochain
  `prisma migrate dev`. Une ouverture concurrente (P2002) renvoie l'alerte
  existante.
- **Une mesure ancienne ne change jamais l'état d'une alerte** : doublons et
  retards sont rejetés par la dédup (ADR 0005) avant l'évaluation.
- **Traçabilité** : chaque transition est journalisée une seule fois sous
  `eventType: 'alert'`, avec `alertId` et l'`eventId` de la mesure qui l'a
  provoquée (aussi stocké dans `openedEventId`/`resolvedEventId`), ce qui
  relie l'alerte à la ligne `measurement_ingestion` correspondante dans
  Loki.
- **Auto-réparation** : la décision repose sur l'état courant (alerte
  ouverte ou non), pas sur le seul franchissement. Si l'écriture de l'alerte
  échoue après celle de la mesure, la mesure suivante encore hors seuil
  rouvre l'alerte — on perd au pire le timestamp exact d'ouverture.

## Alternatives écartées

- **Alertes recalculées à la lecture** (comparer la dernière mesure au seuil
  dans l'API) : pas d'historique des incidents, pas de date d'ouverture ni
  de retour à la normale, et l'API dupliquerait la règle — interdit par
  l'architecture (ADR 0001).
- **Anti-rebond « N mesures consécutives hors seuil »** : retarde
  l'ouverture de N périodes d'émission et demande de compter des mesures
  par device. L'hystérésis suffit à éviter le battement autour du seuil, la
  plausibilité (`plausibility.ts`) écarte déjà les valeurs aberrantes
  isolées.
- **Dédup temporelle des logs** (« pas plus d'une alerte toutes les X
  minutes ») : masque le problème sans modéliser l'incident, et un incident
  long produirait quand même plusieurs alertes.

## Conséquences / limites

- Un capteur qui se tait pendant une alerte ouverte la laisse ouverte : ce
  n'est pas un retour à la normale, on ne sait pas. L'écran s'appuie sur la
  fraîcheur (`fresh`, badge « Capteur silencieux », ADR 0006) pour le
  signaler.
- `recordOngoing` écrit une ligne `UPDATE` par mesure hors seuil : coût
  négligeable face à l'`INSERT` de la mesure elle-même.
- Un seul seuil par type de mesure, commun à toutes les salles ; des seuils
  par salle demanderaient de les stocker en base.
- Les alertes sont liées au device, pas à la salle : un device réaffecté
  (ADR 0007) emporte ses alertes, ouvertes comme passées, dans sa nouvelle
  salle (`GET /rooms/:id/alerts`, `openAlertCount`) — comme ses mesures.
- Les seuils sont en code (`composition.ts`) : les changer demande un
  redéploiement du worker.
