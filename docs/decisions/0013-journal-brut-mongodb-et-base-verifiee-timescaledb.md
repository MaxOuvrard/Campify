# ADR 0013 — Journal brut MongoDB, base vérifiée TimescaleDB

## Statut

Acceptée. Remplace la base brute TimescaleDB/Prisma décrite dans
[ADR 0005](0005-dedup-ordre-et-separation-base-brute-verifiee.md) et le
mécanisme `consolidatedAt` de [ADR 0011](0011-worker-consolidation-polling.md).

## Contexte

L'audit de la base brute (jusqu'ici une table TimescaleDB `RawMeasurement`)
a montré qu'elle n'était pas réellement brute :

- Elle ne stockait pas le message MQTT mais ses métriques **déjà parsées et
  validées par Zod** : un payload invalide, hors contrat ou sur un topic
  inconnu était journalisé puis **perdu** ; les champs d'enveloppe
  (`schema_version`, `room_id`…) étaient jetés.
- Un message à N métriques devenait N lignes écrites une par une, hors
  transaction : un échec au milieu laissait un message à moitié stocké.
- Impossible de rejouer l'historique si une règle de parsing/validation
  changeait, puisque la donnée d'origine n'existait plus.
- Le seul état de traitement était `consolidatedAt`, mis à jour **ligne par
  ligne** : un `UPDATE` d'une colonne indexée par ligne ingérée (427 Mo pour
  ~93 000 lignes), aucune trace du motif de rejet, et une ligne qui échouait
  toujours (device inconnu) **bloquait toute la file** à chaque passage.
- TimescaleDB n'était exploité nulle part : extension installée par le script
  d'init de l'image, zéro hypertable, aucune de ses fonctionnalités
  utilisée. En face, la base « vérifiée » — la seule qui contient de
  vraies séries temporelles — était du PostgreSQL ordinaire.

## Décision

Chaque base prend le rôle pour lequel elle est adaptée.

**Journal brut → MongoDB** (collection `raw_events`). Un document par
message MQTT reçu : `topic`, `payload` exact (même invalide), `qos`,
`retain`, `receivedAt`. Le payload n'a volontairement aucun schéma imposé,
ce qui correspond à un document. Aucune mise à jour, jamais : insertions
seules. Rétention par index TTL (`RAW_EVENTS_RETENTION_DAYS`, 30 par
défaut), gérée par MongoDB.

**Base vérifiée → TimescaleDB.** `Measurement` devient une hypertable
partitionnée par `timestamp` (chunks de 7 jours), avec compression
automatique des chunks de plus de 7 jours, segmentée par `deviceId, type`.
Room, Device, User et Command restent des tables relationnelles ordinaires
dans la même instance (une seule base, les clés étrangères continuent de
fonctionner de la table hypertable vers `Device`). Contrainte TimescaleDB :
la clé primaire doit contenir la colonne de partition → clé composite
`(id, timestamp)` ; aucun code ne requête `Measurement` par `id` seul.
La migration SQL est écrite à la main (`prisma/migrations/20261008090000_*`)
parce que Prisma ne sait pas déclarer une hypertable.

**Ingester : stocker, rien d'autre.** `driving/mqtt` enregistre le message
tel que reçu, avant tout parsing. Une panne de Mongo se voit dans les logs
(`failed to record raw event`), jamais comme un message silencieusement
rejeté.

**Worker : décoder et consolider.** `driving/worker` lit le journal depuis
un **curseur** `(receivedAt, id)` persisté dans la collection
`consolidation_checkpoints` après chaque lot. Il décode chaque message avec
le contrat (`decodeTelemetry` dans `driving/mqtt/schemas.ts`, seul endroit
qui connaît le contrat), puis appelle le même domaine
(`MeasurementIngestionService.consolidate()`, règles inchangées).

- Illisible ou rejeté pour de bon (JSON invalide, hors contrat, topic
  inconnu, device inconnu = `DomainError`) → collection `dead_letters`
  avec l'événement complet et le motif ; le curseur avance.
- Toute autre erreur (base vérifiée indisponible) est transitoire : le
  curseur reste avant l'événement fautif, il est retenté au passage suivant ;
  rien n'est perdu ni dead-letteré pendant une panne.
- Lots pleins enchaînés sans attendre l'intervalle ; chaque passage journalise
  `eventType: consolidation_lag` (`processed`, `pending`) — le retard du worker
  est enfin mesurable.
- Les événements ne sont plus modifiés : plus d'`UPDATE` ni de gonflement de
  table.

## Conséquences

- Le journal est réellement rejouable : remettre le curseur à zéro (ou
  supprimer le document de checkpoint) re-consolide tout l'historique, la
  dédup par `messageId`/timestamp absorbant ce qui existe déjà.
- Un nouveau service (`mongo`), une dépendance (`mongodb`), trois adapters
  dans `infra/mongo/` derrière trois ports (`RawEventRepository`,
  `ConsolidationCheckpointRepository`, `DeadLetterRepository`). Le domaine
  n'a pas de dépendance nouvelle.
- PostgreSQL « simple » ne suffit plus : la migration exige l'extension
  TimescaleDB (image `timescale/timescaledb`). Sur un volume PostgreSQL
  existant, `shared_preload_libraries=timescaledb` doit être passé en
  ligne de commande (fait dans `docker-compose.yml`) ; l'image ne le
  configure qu'à l'initialisation d'un volume vide.
- Les anciennes données de l'ancienne base brute (volume `timescale-data`)
  ne sont pas migrées : elles étaient déjà consolidées dans la base
  vérifiée, seule la zone de transit disparaît.
- Les schéma/client/migrations Prisma de la base brute sont supprimés.

## Alternatives écartées

- **Garder la table TimescaleDB brute en y ajoutant une colonne `jsonb`.**
  Aurait corrigé la fidélité du payload mais pas l'`UPDATE` par ligne, ni le
  besoin d'un schéma pour stocker du hors-contrat ; et aurait gardé une
  hypertable inutile (rien de temporel à en tirer côté brut).
- **Un seul PostgreSQL avec `jsonb` pour le brut.** Plus simple
  opérationnellement (pas de nouvelle techno) et défendable ; écarté parce
  que le journal brut doit absorber le plus de volume possible sans partager
  les ressources de la base servie à l'API.
- **File dédiée (Redis/Kafka).** Déjà écartée par l'ADR 0011 ; un journal
  consultable avec curseur répond au besoin sans nouvelle brique de
  messagerie.

## Limites connues

- **Une seule instance de worker** par nom de consommateur : l'ordre de
  traitement par device+type est ce qui garantit la règle de dédup/retard.
  Passer à N workers demande de partitionner par hash(`deviceId`), avec un
  curseur par partition — non fait.
- **Le curseur suppose que `receivedAt` croît.** `CONSOLIDATION_SETTLE_MS`
  (1 s) laisse aux insertions concurrentes le temps de devenir visibles ; un
  événement inséré plus de 1 s après son horodatage serait sauté. Les
  ingesters tournent sur des horloges synchronisées (même hôte/cluster).
- **Erreur transitoire permanente** : une erreur non `DomainError` qui se
  reproduit pour un événement précis (cas non anticipé) bloquerait la file
  en retentant, avec un `consolidation polling tick failed` + `eventId` dans
  les logs à chaque passage. Choix assumé : mieux vaut bloquer visiblement
  que perdre silencieusement pendant une panne de la base vérifiée.
- **Acquittement avant écriture** : mqtt.js (MQTT 3.1.1) acquitte le message
  auprès du broker avant la fin de l'écriture Mongo. Un crash entre l'ack et
  l'insertion perd ce message malgré QoS 1 + session persistante (voir
  ADR 0010). Ce que l'ADR garantit : ce qui est dans le journal n'est jamais
  perdu ni silencieusement filtré.
- **Payload stocké en UTF-8** : un payload contenant des octets non UTF-8
  serait altéré à la décodage. Les payloads du kit sont du JSON.
- **Mongo local sans authentification**, lié à `127.0.0.1` : démo seulement.
