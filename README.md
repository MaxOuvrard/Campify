# Campify

Supervision de salles (CO₂, température) : des capteurs publient leurs mesures
en MQTT, le backend les vérifie, les stocke et déclenche des alertes ; l'app
mobile affiche l'état des salles, les alertes, l'historique, et pilote la
ventilation d'un capteur. Vue d'ensemble : [docs/architecture.md](docs/architecture.md).

## Structure du projet

```
/
├── backend/          # API (Fastify), ingester MQTT, worker de consolidation — TypeScript
├── mobile/           # Application mobile (React Native / Expo) — TypeScript
├── infra/            # vide (déploiement non réalisé, voir limites dans docs/J5.md)
└── docs/
    ├── architecture.md
    ├── decisions/    # ADR 0001 → 0015
    ├── preuves/      # preuves reproductibles (J3, J4, J5)
    └── J1.md … J5.md # journaux et réponses aux questions de chaque journée
```

## Lancer le système (reproductible, ~10 min)

Prérequis : **Docker** (Docker Desktop) et **Node.js 20+**. Commandes à lancer
depuis un terminal bash (Git Bash sous Windows).

### 1. Backend complet (API, ingester, worker, bases, broker, logs)

```bash
cd backend
npm install
cp .env.example .env

# Identités MQTT du broker local (connexion anonyme refusée, ACL par device — ADR 0008) :
# le backend, puis un identifiant par capteur simulé. -c crée le fichier, ne l'utiliser qu'une fois.
docker run --rm -v "$(pwd):/mosquitto" eclipse-mosquitto:2 mosquitto_passwd -b -c /mosquitto/mosquitto.passwd backend changeme-local-only
for d in sensor-001 sensor-002 sensor-003; do
  docker run --rm -v "$(pwd):/mosquitto" eclipse-mosquitto:2 mosquitto_passwd -b /mosquitto/mosquitto.passwd $d changeme-local-only
done

docker compose up -d --build   # PostgreSQL/TimescaleDB, MongoDB, Mosquitto, API, ingester, worker, Loki, Promtail, Grafana
npx prisma db seed             # 3 salles / 3 capteurs + comptes de démo (voir ci-dessous)
```

L'API applique ses migrations au démarrage ; si `prisma db seed` échoue
juste après `up`, attendre quelques secondes que le conteneur `backend` ait
fini (`docker compose logs backend`).

Vérifier : `curl http://localhost:3000/rooms` doit répondre `401` (API
joignable, authentification requise).

| Compte | Mot de passe | Droits |
|---|---|---|
| `demo@campify.local` | `campify-demo` | consultation (VIEWER) |
| `operateur@campify.local` | `campify-operateur` | consultation + commandes (OPERATOR) |

### 2. Faire publier des capteurs

```bash
cd backend
# 3 salles, une seule en pic de CO2 (alerte puis retour à la normale en ~2 min) :
npm run simulate:devices -- --password changeme-local-only --co2-spike sensor-001 --qos 1
```

Sans `--co2-spike`, les capteurs suivent une marche aléatoire (et répondent
aux commandes de ventilation). Toutes les options : `npm run simulate:devices -- --help`.

### 3. App mobile

```bash
cd mobile
npm install
cp .env.example .env   # sur un téléphone physique : EXPO_PUBLIC_API_URL=http://<IP-LAN-du-PC>:3000
npm start              # puis Expo Go (QR code), ou touche a (Android) / w (web)
```

Se connecter avec un des comptes ci-dessus.

### 4. Observer

- **Logs centralisés** : Grafana [http://localhost:3001](http://localhost:3001) (sans login) —
  dashboards *Campify — Logs backend* (suivi d'une mesure par `eventId`,
  alertes, rejets, MQTT) et *Campify — Commandes* (parcours d'un `commandId`).
- **Parcours d'une commande** : `cd backend && npm run trace:command -- <commandId>`.
- **Essai de charge multi-salles** : voir [docs/preuves/j5/README.md](docs/preuves/j5/README.md).

## Tests

```bash
cd backend && npm test    # typecheck + unitaires + intégration (tests Prisma/Mongo si la stack Docker tourne et .env chargé)
cd mobile && npx jest
```

## Pour aller plus loin

- Détails backend (lancement hors Docker, scénarios J3/J4 du simulateur) : [backend/README.md](backend/README.md)
- État du projet, limites connues, contributions : [docs/J5.md](docs/J5.md)
