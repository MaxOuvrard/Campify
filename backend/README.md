# Backend Campify

API Fastify (TypeScript) en architecture hexagonale simplifiée. Voir
[docs/architecture.md](../docs/architecture.md) pour la vue d'ensemble et
[docs/decisions/](../docs/decisions/) pour le détail des choix.

## Prérequis

- Node.js 20+
- Docker (pour Postgres + Mosquitto en local, via `docker-compose.yml`)

## Démarrage

```bash
npm install
cp .env.example .env   # ajuster si besoin

# Identifiants du mosquitto local — voir ADR 0008 : le broker refuse les
# connexions anonymes et applique une ACL (mosquitto.acl), donc ce fichier
# doit exister avant de démarrer Mosquitto. Le mot de passe doit
# correspondre à celui mis dans MQTT_URL (.env).
docker run --rm -v "$(pwd):/mosquitto" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /mosquitto/mosquitto.passwd backend changeme-local-only

docker compose up -d   # Postgres (5432), Mosquitto (1883), Loki/Promtail/Grafana (3001)
npx prisma migrate dev # crée le schéma en base
npx prisma db seed     # salles/devices de démo + utilisateur demo@campify.local
npm run dev             # API — lecture base vérifiée + publication de commandes
npm run ingester        # 2e terminal — indispensable, voir ci-dessous
npm run worker          # 3e terminal — indispensable, voir ci-dessous
```

⚠️ **`npm run ingester` et `npm run worker` sont obligatoires, pas
optionnels** — depuis les ADR 0011/0012, `npm run dev` (l'API) ne touche
plus du tout à MQTT ni à la base brute. Sans l'ingester, aucune mesure
n'est même reçue ; sans le worker, ce que l'ingester écrit en base brute
n'est jamais dédupliqué/consolidé en base vérifiée — dans les deux cas,
l'API renverrait toujours une liste vide. Avec `docker compose up -d
--build` (plus bas), les services `ingester` et `worker` démarrent
automatiquement avec le reste — pas d'action manuelle dans ce cas.

Pour tester le scénario "usurpation d'un device" (publier manuellement sur le
topic d'un autre capteur), ajouter un identifiant par device avec `-b` (sans
`-c`, qui écraserait le fichier) : `mosquitto_passwd -b mosquitto.passwd
sensor-001 <mot-de-passe>`. L'ACL n'autorise chaque identité qu'à publier
sur sa propre télémétrie (`pattern write .../%u/telemetry`).

L'API est servie sur [http://localhost:3000](http://localhost:3000).

Les logs sont centralisés et consultables sur Grafana
([http://localhost:3001](http://localhost:3001), pas de login) — dashboard
"Campify — Logs backend (J3)" provisionné automatiquement. **Seuls les
logs du conteneur `backend`** y apparaissent (Promtail scrute les
conteneurs Docker, pas un `npm run dev` lancé hors conteneur) : pour les
voir dans Grafana, démarrer aussi le backend via Docker Compose (« Alternative :
tout via Docker Compose » plus bas) plutôt qu'avec `npm run dev`. Détail :
[backend/observability/README.md](observability/README.md).

### Voir de vraies mesures (broker de démo du kit)

Avec la configuration par défaut (`MQTT_URL=mqtt://localhost:1883`),
l'ingester (seul abonné MQTT, voir ADR 0012) écoute le Mosquitto local du
`docker-compose.yml` — sans device qui y publie, aucune mesure n'arrive.
Pour recevoir les mesures réelles du kit de démo, pointer `MQTT_URL` vers
le broker de démonstration au format
`mqtt://<user>:<password>@<host>:<port>` — **adresse et identifiants à
demander à l'équipe**, jamais commités (voir [ADR 0004](../docs/decisions/0004-contrat-mqtt-placeholder.md)
pour le contexte, et le rappel dans `.env.example`).

### Simuler des devices en local (sans le kit)

Pour rejouer les scénarios J3 (doublon, coupure brutale, montée en charge,
message retained, comparaison QoS) sans dépendre du broker partagé du
kit : `backend/scripts/simulate-devices.ts`, publie de la télémétrie
plausible pour plusieurs devices en parallèle sur le mosquitto local.

```bash
npm run simulate:devices -- --password changeme-local-only
```

Un identifiant par device doit avoir été généré au préalable (section
Démarrage ci-dessus, un device = une identité MQTT distincte imposée par
l'ACL). Voir `npm run simulate:devices -- --help` pour les options
(`--qos`, `--retain`, `--duplicate-rate`, `--interval`, `--devices`…).
Interrompre avec Ctrl+C ; un `kill -9`/fermeture brutale du terminal
simule un capteur qui s'arrête sans déconnexion propre.

### Alternative : tout via Docker Compose

`docker compose up -d --build` démarre aussi l'API, l'ingester et le
worker (trois conteneurs buildés depuis le même `Dockerfile`), en plus de
Postgres, TimescaleDB et Mosquitto — pratique pour tester l'image sans
environnement Node local. Le conteneur `backend` applique les migrations
(`prisma migrate deploy`) au démarrage ; `ingester`/`worker` ne les
relancent pas (ils attendent juste que `backend` soit démarré). Il faut
lancer `npx prisma db seed` séparément (en local, contre le Postgres
exposé sur `5432`) pour peupler les données de démo.

### Trois process, trois responsabilités

Depuis les ADR [0011](../docs/decisions/0011-worker-consolidation-polling.md)
et [0012](../docs/decisions/0012-ingester-separe-souscription-partagee.md),
une mesure traverse trois process séparés, chacun pouvant tomber ou
saturer sans affecter les deux autres :

1. **Ingester** (`npm run ingester`, service `ingester`) — seul abonné
   MQTT (mesures + accusés de commande). Écrit en base brute
   (TimescaleDB) et s'arrête là, aucune décision métier. Peut tourner en
   plusieurs instances (`docker compose up -d --scale ingester=3`) :
   souscription partagée (`MQTT_SHARED_GROUP`, déjà positionné dans
   `docker-compose.yml`) — chaque message n'est alors traité que par une
   seule instance, jamais dupliqué vers toutes.
2. **Worker** (`npm run worker`, service `worker`) — interroge la base
   brute toutes les `CONSOLIDATION_POLL_INTERVAL_MS` (3s par défaut) pour
   ce qui n'a pas encore été traité, applique dédup/plausibilité, écrit en
   base vérifiée (PostgreSQL) si accepté.
3. **API** (`npm run dev`, service `backend`) — ne lit que la base
   vérifiée. Garde un client MQTT, mais uniquement pour publier des
   commandes (`POST /devices/:id/commands`), jamais pour s'abonner.

Un délai de quelques secondes entre réception MQTT et disponibilité via
l'API est donc normal (pas un bug) — largement sous les seuils de
fraîcheur de l'app (minutes).

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Démarre l'API en mode watch (tsx) — lecture base vérifiée + publication de commandes |
| `npm run ingester` | Démarre l'ingester (seul abonné MQTT) en mode watch (tsx) — voir ADR 0012 |
| `npm run worker` | Démarre le worker de consolidation en mode watch (tsx) — voir ADR 0011 |
| `npm run build` | Compile TypeScript vers `dist/` |
| `npm start` | Démarre la version compilée de l'API (`dist/index.js`) |
| `npm run ingester:start` | Démarre la version compilée de l'ingester (`dist/ingester.js`) |
| `npm run worker:start` | Démarre la version compilée du worker (`dist/worker.js`) |
| `npm run typecheck` | Vérifie les types sans émettre de fichiers |
| `npm test` | Typecheck + tests unitaires et d'intégration |
| `npm run prisma:generate` | Régénère le client Prisma |
| `npm run prisma:migrate` | Applique les migrations en dev |
| `npm run prisma:studio` | Interface d'exploration de la base |
| `npm run prisma:seed` | Peuple les salles/devices de démo + l'utilisateur `demo@campify.local` |
| `npm run simulate:devices` | Simule plusieurs devices MQTT en parallèle (scénarios J3), voir plus haut |

## Structure

```
src/
├── domain/       # entités, ports (interfaces), services métier purs
├── infra/        # adapters Prisma (DB) et mqtt.js (publisher de commandes)
├── driving/      # adapters Fastify (API), mqtt.js (souscription), worker de consolidation
├── composition.ts
├── index.ts      # process API — lecture base vérifiée + publication de commandes
├── ingester.ts    # process ingester — seul abonné MQTT (ADR 0012)
├── worker.ts      # process worker de consolidation (ADR 0011)
└── shared/       # config, logger, erreurs, conventions de topics MQTT
```

## Tests

```bash
npm test
```

- Les tests unitaires de `domain/services` utilisent des fakes en mémoire
  (`test/fakes/`), sans DB ni broker MQTT réels.
- Le test de contrat du repository Prisma
  (`test/infra/db/prismaRoomRepository.test.ts`) nécessite une base
  réelle : il est automatiquement ignoré si `DATABASE_URL` n'est pas
  définie.

## ⚠️ Contrat MQTT — commandes encore provisoires

Le contrat de **télémétrie** (topics + payloads, `src/shared/mqttTopics.ts`,
`src/driving/mqtt/schemas.ts`) est confirmé : observé sur le broker de
démonstration. Le contrat de **commandes/acquittements** reste un
**placeholder** non vérifié (aucune commande n'a encore été publiée vers
le kit). Voir [ADR 0004](../docs/decisions/0004-contrat-mqtt-placeholder.md)
pour le détail de ce qui reste à ajuster.
