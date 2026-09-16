# ADR 0005 — Déduplication, ordre des mesures et séparation base brute / base vérifiée

## Statut

Acceptée.

## Contexte

MQTT (QoS ≥ 1) peut retransmettre le même message, et le réseau peut faire
arriver les mesures hors ordre. Sans règle explicite, une retransmission
crée un doublon métier (deux lignes pour la même mesure), et une mesure en
retard peut écraser silencieusement une mesure plus récente déjà affichée.

Il faut aussi décider où appliquer cette règle : le contrat MQTT du kit
étant un placeholder (voir [[0004-contrat-mqtt-placeholder]]), on veut
pouvoir rejouer/inspecter ce qui a été reçu brut sans dépendre de la
logique de dédup, sans pour autant l'exposer telle quelle à l'API.

## Décision

**Critère de doublon/retard**, dans `domain/services/dedup.ts`
(`decideMeasurement`), appliqué à la dernière mesure connue pour le couple
device+type :

1. Même `messageId` (identifiant du message MQTT source) que la dernière
   mesure connue → **doublon**, quel que soit le timestamp. C'est le signal
   le plus fiable pour une retransmission exacte : on ne se fie pas à une
   éventuelle coïncidence de date.
2. À défaut de `messageId` des deux côtés, on retombe sur le timestamp :
   même timestamp que la dernière connue → **doublon** ; timestamp
   antérieur → **retard**, rejeté (ne remplace jamais l'état courant qui,
   par construction, est déjà plus récent).
3. Timestamp postérieur → **acceptée**, devient la nouvelle dernière
   mesure connue.

**Séparation en deux bases**, dans `MeasurementIngestionService.ingest()` :

- Une base **brute** (TimescaleDB, port `RawMeasurementRepository`) reçoit
  systématiquement toute mesure entrante, sans filtre — trace fidèle de ce
  qui a été reçu, y compris doublons et retards, utile pour diagnostiquer
  un device qui spam ou un contrat MQTT qui dérive.
- Cette même ligne est relue depuis la base brute (pas la donnée entrante
  en mémoire), et c'est cette relecture qui passe par `decideMeasurement`.
- Une base **vérifiée** (PostgreSQL, port `MeasurementRepository`) ne
  reçoit que ce qui a été accepté — c'est elle qui alimente l'API
  (dernière valeur, historique, présence).
- Si l'écriture ou la relecture en base brute échoue, la base vérifiée
  n'est délibérément pas alimentée (`reason: 'raw_unavailable'`) : elle ne
  dépend que de ce qui a été relu en base brute, jamais de l'entrée
  MQTT/API directement.

Ceci **précise** [[0002-postgresql-et-prisma]] : l'ADR 0002 envisageait une
extension TimescaleDB sur la *même* base Postgres si le besoin apparaissait ;
l'usage réel (garder une trace brute intacte, y compris les doublons/retards
rejetés, séparée de l'état vérifié servi par l'API) a justifié une base
TimescaleDB distincte plutôt qu'une hypertable sur `Measurement`.

## Conséquences

- Une retransmission MQTT exacte (même `messageId`) ou une mesure en retard
  n'écrit jamais dans la base vérifiée ni ne modifie l'état courant exposé
  par l'API — preuves dans `backend/test/domain/services/dedup.test.ts` et
  `backend/test/domain/services/measurementIngestionService.test.ts`.
- La base brute grossit sans dédup : elle n'est pas bornée par
  `domain/services/history.ts` (qui ne s'applique qu'aux lectures API sur
  la base vérifiée) — une politique de rétention sur la base brute est un
  sujet ouvert, pas encore traité.
- Deux schémas Prisma (`prisma/schema.prisma` pour la base vérifiée,
  `prisma/raw/schema.prisma` pour la base brute) et deux clients générés
  (`npm run prisma:generate` lance les deux) — voir `backend/README.md`.
