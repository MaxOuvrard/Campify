# ADR 0001 — Architecture hexagonale simplifiée pour le backend

## Statut

Acceptée.

## Contexte

Le backend Campify reçoit des mesures IoT via MQTT et expose une API pour
la consultation et l'envoi de commandes. Ces deux entrées (MQTT et HTTP)
doivent appliquer exactement les mêmes règles métier (fraîcheur des
devices, dédup/retard des mesures, alertes de seuil, cycle de vie des
commandes) : les dupliquer entre un handler MQTT et une route API serait
une source de bugs de divergence.

## Décision

Le code est organisé en architecture hexagonale simplifiée :

```
src/
├── domain/            # cœur métier, aucune dépendance vers l'extérieur
│   ├── entities/         # Room, Device, Measurement, Command, User
│   ├── ports/            # interfaces vers l'infra (repositories, MqttPublisher, Clock, Logger)
│   └── services/         # logique métier pure : fraîcheur, dédup/retard, alertes, commandes
│
├── infra/              # adapters, implémentent les ports du domaine
│   ├── db/                # repositories Prisma/Postgres
│   └── mqtt/              # publisher MQTT (émission de commandes)
│
├── driving/             # ce qui déclenche le domaine
│   ├── mqtt/              # client mqtt.js, schémas Zod, handlers
│   └── api/               # routes Fastify, auth JWT, RBAC
│
├── composition.ts       # câblage : instancie les adapters -> injecte dans les services
└── shared/              # logger (pino), config, erreurs typées, conventions MQTT
```

Règle centrale : `driving/mqtt` et `driving/api` appellent le même
domaine (`domain/services`), jamais l'inverse, jamais l'un l'autre
directement. Exemple concret dans le code : `MeasurementIngestionService`
est utilisé par le handler MQTT entrant, et `CommandService` est utilisé
à la fois par la route API `POST /devices/:id/commands` (émission) et par
le handler MQTT d'acquittement (`acknowledge`).

Le domaine ne dépend que d'interfaces (`domain/ports`) et de types purs
(`shared/errors`) : jamais de Prisma, mqtt.js ou Fastify directement. Les
repositories Prisma font le mapping `toDomain()` explicite pour que le
domaine ne dépende jamais de la forme des tables SQL.

## Conséquences

- Les tests unitaires du domaine (`domain/services`) tournent avec des
  fakes en mémoire, sans DB ni broker MQTT réels.
- Ajouter une nouvelle entrée (ex: un futur webhook) ne nécessite que
  d'écrire un nouvel adapter driving qui appelle les services existants.
- Voir aussi [[0003-exclusions-cqrs-event-sourcing-ddd-microservices]]
  pour les patterns explicitement écartés.
