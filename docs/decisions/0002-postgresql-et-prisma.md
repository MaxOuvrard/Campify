# ADR 0002 — PostgreSQL relationnel + Prisma

## Statut

Acceptée.

## Contexte

Les entités du domaine (Room, Device, Measurement, Command, User) ont des
relations stables et connues à l'avance (un device appartient à une room,
une mesure/commande appartient à un device), imposées par le contrat MQTT
du kit. C'est le cas typique où le relationnel évite de dupliquer des
données ou de faire des jointures applicatives manuelles qu'un document
store imposerait.

## Décision

- **PostgreSQL** comme base de données, avec un schéma relationnel
  classique (voir `backend/prisma/schema.prisma`).
- Table `Measurement` avec un index composite `(deviceId, timestamp)`
  pour le socle actuel (requêtes de plage par device).
- Si l'historique long devient un besoin (rétention, agrégations sur de
  gros volumes), extension **TimescaleDB** sur la même base Postgres
  plutôt qu'une DB time-series séparée : même moteur, mêmes requêtes SQL,
  juste des hypertables en plus sur `Measurement`. Non activé pour
  l'instant.
- **Prisma** comme ORM : migrations, typage généré, et mapping explicite
  domaine ↔ persistance dans chaque repository (`toDomain()`) pour que le
  domaine ne dépende jamais de la forme des tables SQL — voir
  [[0001-architecture-hexagonale]].

## Conséquences

- `npx prisma migrate dev` gère les migrations de schéma en local.
- Les tests d'intégration des repositories Prisma (`backend/test/infra/db`)
  nécessitent une vraie base (via `docker-compose.yml`) et sont
  automatiquement ignorés si `DATABASE_URL` n'est pas définie.
