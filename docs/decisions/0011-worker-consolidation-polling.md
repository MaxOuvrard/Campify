# ADR 0011 — Worker de consolidation séparé (polling)

## Statut

Acceptée.

## Contexte

Le scénario J3 "Montée en charge locale" avait identifié, sans le corriger,
que le process backend sature (300-370% CPU) bien avant le broker ou les
bases sous forte charge MQTT — voir `docs/J3.md`. Comme ce même process
sert aussi l'API HTTP, un pic d'ingestion MQTT peut dégrader les réponses
de l'API : les deux partagent le même event loop.

Jusqu'ici, `MeasurementIngestionService.ingest()` faisait tout d'un coup,
en synchrone, dans le handler MQTT : écriture en base brute, relecture,
dédup/plausibilité, écriture en base vérifiée, alertes. Toute cette charge
retombait donc sur le seul process qui sert aussi l'API.

## Décision

Couper le traitement en deux étapes séparées dans le temps, portées par
deux process distincts :

1. **Chemin rapide** (`driving/mqtt`, process `backend` existant) —
   `MeasurementIngestionService.recordRaw()` : valide le schéma (Zod,
   inchangé), écrit en base brute, s'arrête là. Aucune décision métier,
   aucune écriture en base vérifiée.
2. **Worker de consolidation** (nouveau process séparé, `driving/worker`,
   `src/worker.ts`) — interroge la base brute toutes les
   `CONSOLIDATION_POLL_INTERVAL_MS` (3s par défaut) pour les lignes pas
   encore traitées (`RawMeasurement.consolidatedAt IS NULL`), et appelle
   `MeasurementIngestionService.consolidate()` sur chacune, **une par une,
   dans l'ordre** — jamais en parallèle, pour ne pas faire lire à deux
   lignes du même device+type le même état "dernière connue" avant qu'aucune
   des deux n'ait écrit.

La logique de dédup/plausibilité/alertes (`dedup.ts`, `plausibility.ts`,
`alerts.ts`) n'a pas bougé — seul son point d'appel a changé, conformément
à la règle centrale du projet (ADR 0001) : aucune règle métier dupliquée,
seulement un nouveau point d'entrée `driving` qui appelle le même domaine.

Un nouveau champ `RawMeasurement.consolidatedAt` (nullable) marque ce qui
a déjà été traité par le worker — qu'une ligne ait été acceptée ou
rejetée, elle est marquée consolidée dans les deux cas, pour ne jamais
être reprise.

## Alternatives envisagées

- **File d'attente Redis (ex. BullMQ)**, où le chemin rapide pousserait un
  job après l'écriture brute, consommé immédiatement par le worker —
  envisagé en premier. Rejeté au profit du polling pour ce projet :
  - Pas de nouvelle dépendance ni de nouveau service à exploiter (pas de
    Redis dans `docker-compose.yml`).
  - Le polling absorbe mieux une rafale : un pic de 500 messages est
    traité en un seul lot au prochain passage, plutôt que comme 500 jobs
    traités un par un.
  - Le délai induit (jusqu'à `CONSOLIDATION_POLL_INTERVAL_MS`, quelques
    secondes) est négligeable face aux seuils de fraîcheur de l'app
    (`DEVICE_STALE_THRESHOLD_MS`, 5 min par défaut) — contrairement à
    Redis, quasi instantané, mais pour un besoin que le projet n'a pas.
  - Reste un choix réversible : si le volume dépassait un jour ce qu'un
    seul worker séquentiel absorbe, Redis/BullMQ redeviendrait pertinent
    (voir Conséquences).
- **Worker dans le même process** (juste un `setInterval` à côté du reste) :
  rejeté, ça ne règle rien — même event loop, même contention avec l'API.

## Conséquences

- Délai de quelques secondes (pas plus que `CONSOLIDATION_POLL_INTERVAL_MS`)
  entre la réception MQTT et la disponibilité d'une mesure via l'API —
  accepté, invisible aux seuils de fraîcheur de l'app.
- Un seul worker à la fois suppose un traitement strictement séquentiel
  dans ce process — si plusieurs instances du worker tournaient un jour en
  parallèle, deux d'entre elles pourraient consolider la même ligne en
  même temps (pas de verrou distribué). Non testé, limite assumée pour un
  worker en instance unique.
- `docker-compose.yml` gagne un service `worker`, construit depuis la même
  image que `backend` (`node dist/worker.js`) — `depends_on: backend`
  uniquement pour que les migrations (lancées par `backend` au démarrage)
  soient déjà appliquées.
- Nouvelle migration `RawMeasurement.consolidatedAt` (nullable, indexée
  avec `receivedAt` pour que la requête de polling reste rapide même avec
  beaucoup de lignes déjà consolidées).

## Mise à jour (ADR 0013)

Le worker ne cherche plus les lignes `consolidatedAt IS NULL` : il lit le
journal MongoDB depuis un curseur persisté, envoie les événements
illisibles en dead-letter au lieu de bloquer la file, et enchaîne les lots
pleins sans attendre. Le polling périodique et la règle « un seul
traitement à la fois par device+type » restent. Voir
[ADR 0013](0013-journal-brut-mongodb-et-base-verifiee-timescaledb.md).
