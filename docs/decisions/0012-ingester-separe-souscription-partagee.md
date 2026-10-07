# ADR 0012 — Ingester séparé de l'API, souscription MQTT partagée

## Statut

Acceptée.

## Contexte

Après l'ADR 0011 (worker de consolidation séparé), le process API gardait
encore l'abonnement MQTT entrant (`recordRaw()` — validation Zod + écriture
en base brute). Plus léger que l'ancien `ingest()` complet, mais toujours
dans le même process que les réponses HTTP : un pic de charge MQTT, même
réduit à ce chemin rapide, reste une charge **partagée** avec l'API tant
que les deux tournent dans le même process.

Par ailleurs, l'abonnement MQTT était lié à **une seule instance possible**
(ADR 0010 : `clientId` fixe `'campify-backend'`, une deuxième instance
avec le même id ferait déconnecter la première). Pas de façon de répartir
la charge d'ingestion sur plusieurs instances sans ce changement.

## Décision

Extraire l'abonnement MQTT dans un troisième process, symétrique aux deux
autres (API, worker) :

- **Nouveau `startIngester()`** (`src/ingester.ts`, nouvel adapter
  `driving/mqtt` dédié) — seul abonné MQTT (mesures + accusés de commande), appelle
  `recordRaw()` (écrit en base brute) et `commandService.acknowledge()`
  (écrit le statut en base vérifiée). Ne sert jamais de HTTP.
- **Process API (`startApplication()`)** — ne s'abonne plus à rien. Ne lit
  que la base vérifiée. Garde un client MQTT, mais uniquement pour
  **publier** des commandes (`POST /devices/:id/commands`) — pas de
  session persistante nécessaire pour un client qui ne fait que publier à
  la demande, rien à rattraper pour lui.
- **`clientId` dérivé du hostname du conteneur** (`campify-ingester-${hostname()}`)
  plutôt que fixe en dur — chaque instance/replica a son propre identifiant
  stable (stable tant que le conteneur n'est pas recréé), donc plusieurs
  instances peuvent coexister sans se déconnecter mutuellement.
- **Souscription partagée MQTT** (`$share/<groupe>/<topic>`,
  `MQTT_SHARED_GROUP`) : quand définie, le broker répartit chaque message
  entre les instances du groupe — un message = une seule instance qui le
  traite, pas une copie par instance. Sans ça, lancer plusieurs ingesters
  n'aurait fait que **dupliquer** le travail (chaque instance aurait reçu
  et traité chaque message), pas le répartir — le pub/sub MQTT classique
  envoie une copie à **chaque** abonné, ce n'est pas une file d'attente à
  consommateurs concurrents par défaut.
- Vide par défaut (`.env`) pour ne pas risquer de casser la connexion vers
  le broker du kit (VPS, support de `$share` non vérifié) ; défini dans
  `docker-compose.yml` (service `ingester`) pour l'usage local, où
  Mosquitto le supporte (confirmé — voir Vérification).

## Vérification

Scénario rejoué en local : 3 instances de `ingester` (`docker compose up
-d --scale ingester=3`), 6 mesures publiées avec des `message_id`
distincts → **6 lignes en base brute, pas 18** (`select count(*) ... group
by messageId` → 1 par message_id). Confirme que Mosquitto répartit bien
les messages entre les 3 instances au lieu de les dupliquer vers chacune.

## Alternatives envisagées

- **Partitionner par device** (chaque instance ne s'abonne qu'à un
  sous-ensemble de `deviceId`) : rejeté, demande une coordination externe
  (qui est responsable de quel device) que la souscription partagée offre
  nativement, sans configuration manuelle.
- **Ne rien changer, garder l'abonnement dans le process API** : le chemin
  rapide (`recordRaw`) est déjà léger après l'ADR 0011 ; pas de nouvelle
  mesure de charge confirmant que ça sature encore quoi que ce soit. Fait
  quand même, par cohérence avec la séparation déjà actée pour le worker,
  et parce que ça ouvre la possibilité de scaler l'ingestion sans aucun
  changement de code plus tard.

## Conséquences

- Process API simplifié : ne dépend plus de TimescaleDB (base brute) du
  tout, uniquement de PostgreSQL (base vérifiée) — correspond
  explicitement à "l'API ne tape que sur la base validée".
- Un `ingester` de plus à déployer/surveiller — `docker-compose.yml` gagne
  un service `ingester`, même image que `backend`/`worker`.
- Le support de `$share` par le broker du kit (VPS) reste non vérifié —
  risque résiduel documenté, pas testé contre ce broker partagé (même
  limite que pour d'autres aspects du VPS, voir ADR 0008).
- `clientId` dérivé du hostname : si le conteneur est recréé (pas juste
  redémarré), son hostname change (nouvel id Docker) → nouvelle session,
  perte de la mémorisation côté broker pour l'ancienne. Acceptable : un
  redémarrage simple (`docker compose restart ingester`) garde le même
  conteneur, donc le même hostname, donc la même session.

## Mise à jour (ADR 0013)

L'ingester n'écrit plus dans une base brute Prisma : il insère chaque
message MQTT tel quel dans MongoDB, sans le parser. Plusieurs instances
écrivent dans la même collection ; le worker les relit toutes dans l'ordre
`receivedAt`. Voir [ADR 0013](0013-journal-brut-mongodb-et-base-verifiee-timescaledb.md).
