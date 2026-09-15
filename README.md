# Campify

## Structure du projet

```
/
├── backend/          # API et logique serveur
├── mobile/           # Application mobile
├── infra/            # Infrastructure et déploiement
├── docs/             # Documentation
│   ├── architecture.md
│   ├── decisions/
│   ├── J1.md
│   ├── J2.md
│   ├── J3.md
│   └── J4.md
└── README.md
```

## Stack technique

- **mobile/** — application mobile en [React Native](https://reactnative.dev/) via [Expo](https://expo.dev/) (TypeScript)
- **backend/** — API en [Fastify](https://fastify.dev/) (TypeScript), architecture hexagonale (domaine + adapters MQTT/API), PostgreSQL via Prisma — voir [docs/architecture.md](docs/architecture.md)
- **infra/** — _à définir_

## Démarrage

### Mobile

```bash
cd mobile
npm install
npm start
```

Puis suivre les instructions Expo (scan du QR code avec l'app Expo Go, ou `npm run android` / `npm run ios` / `npm run web`).

### Backend

```bash
cd backend
npm install
cp .env.example .env
docker compose up -d   # Postgres + Mosquitto
npx prisma migrate dev
npx prisma db seed     # salles/devices de démo + utilisateur demo@campify.local
npm run dev
```

L'API est servie sur [http://localhost:3000](http://localhost:3000). Détails dans [backend/README.md](backend/README.md).
