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
npm run dev
```

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

Avec la configuration par défaut (`MQTT_URL=mqtt://localhost:1883`), le
backend écoute le Mosquitto local du `docker-compose.yml` — sans device qui
y publie, aucune mesure n'arrive. Pour recevoir les mesures réelles du kit
de démo, pointer `MQTT_URL` vers le broker de démonstration (adresse et
identifiants dans
[ADR 0004](../docs/decisions/0004-contrat-mqtt-placeholder.md)), au format
`mqtt://<user>:<password>@<host>:<port>`.

### Alternative : tout via Docker Compose

`docker compose up -d --build` démarre aussi le backend (dans un
conteneur buildé depuis le `Dockerfile`), en plus de Postgres et
Mosquitto — pratique pour tester l'image sans environnement Node local.
Le conteneur applique les migrations (`prisma migrate deploy`) au
démarrage ; il faut lancer `npx prisma db seed` séparément (en local,
contre le Postgres exposé sur `5432`) pour peupler les données de démo.

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Démarre l'API et le client MQTT en mode watch (tsx) |
| `npm run build` | Compile TypeScript vers `dist/` |
| `npm start` | Démarre la version compilée (`dist/index.js`) |
| `npm run typecheck` | Vérifie les types sans émettre de fichiers |
| `npm test` | Typecheck + tests unitaires et d'intégration |
| `npm run prisma:generate` | Régénère le client Prisma |
| `npm run prisma:migrate` | Applique les migrations en dev |
| `npm run prisma:studio` | Interface d'exploration de la base |
| `npm run prisma:seed` | Peuple les salles/devices de démo + l'utilisateur `demo@campify.local` |

## Structure

```
src/
├── domain/       # entités, ports (interfaces), services métier purs
├── infra/        # adapters Prisma (DB) et mqtt.js (publisher de commandes)
├── driving/      # adapters Fastify (API) et mqtt.js (souscription)
├── composition.ts
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
