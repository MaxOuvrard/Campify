# Campify

Monorepo : `backend/` (API Fastify), `mobile/` (Expo/React Native), `infra/`
(à définir), `docs/` (architecture, décisions, journaux).

## Avant de coder dans `backend/`

Lire [docs/architecture.md](docs/architecture.md) et les ADR dans
[docs/decisions/](docs/decisions/) — ne pas redécouvrir ces choix par
tâtonnement.

Règles dures de l'architecture hexagonale du backend :

- `domain/` (entités, ports, services) ne dépend **jamais** de Prisma,
  mqtt.js ou Fastify — seulement de ses propres interfaces (`domain/ports`)
  et de `shared/errors`.
- `driving/mqtt` et `driving/api` sont deux entrées symétriques qui
  appellent le **même** domaine — elles ne s'appellent jamais l'une
  l'autre, et ne dupliquent jamais une règle métier (fraîcheur, dédup,
  alertes, cycle de vie des commandes) localement.
- Nouvelle règle métier → dans `domain/services`, jamais dans une route ou
  un handler MQTT.
- Nouvelle source de données/notif → nouvel adapter dans `infra/`
  implémentant un port existant ou nouveau dans `domain/ports`.
- Câblage (instanciation + injection) uniquement dans
  `backend/src/composition.ts`.

Le contrat MQTT (topics, forme des payloads) est un **placeholder** —
voir [ADR 0004](docs/decisions/0004-contrat-mqtt-placeholder.md). Si le
vrai contrat du kit est fourni, mettre à jour uniquement
`shared/mqttTopics.ts` et `driving/mqtt/schemas.ts` ; le domaine ne doit
pas changer.

## Commandes utiles

```bash
cd backend
npm run dev        # API + client MQTT en watch
npm test           # typecheck + tests (unitaires + intégration)
npm run build      # compilation TypeScript
```

Détails complets : [backend/README.md](backend/README.md).
