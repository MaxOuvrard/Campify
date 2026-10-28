# Logs centralisés (Loki + Promtail + Grafana)

Fait partie de `docker-compose.yml` — démarre avec le reste (`docker
compose up -d`), rien à lancer séparément.

## Accès

- **Grafana** : [http://localhost:3001](http://localhost:3001) — pas de
  login (auth anonyme, stack locale uniquement, voir
  [ADR 0009](../../docs/decisions/0009-stack-logs-centralises.md)).
  Dashboard **Campify — Logs backend (J3)** provisionné automatiquement
  (dossier "Campify"), avec 6 panneaux déjà filtrés :
  1. Événements d'un device (variable `$deviceId` en haut du dashboard)
  2. Messages rejetés
  3. Doublons détectés
  4. Données anciennes / en retard
  5. Connexion MQTT (coupures, erreurs, reprises)
  6. Tous les logs backend (flux brut, sans filtre)

  Dashboard **Campify — Commandes (J4)** : parcours d'une commande
  (variable `$commandId`, ordre chronologique, tous services), anomalies
  (timeout, ACK tardif, doublons, ACK perdu…), transitions d'état, demandes
  reçues par l'API, et vue côté objet (simulateur). Voir
  [ADR 0014](../../docs/decisions/0014-cycle-de-vie-des-commandes.md).
- **En ligne de commande** : `npm run trace:command -- <commandId>`
  reconstruit le même parcours depuis Loki + la base, coche les étapes
  attendues et indique la première étape manquante (preuve reproductible,
  voir `docs/preuves/j4/`).
- **Loki** (API brute) : [http://localhost:3100](http://localhost:3100),
  rarement utile directement — passer par Grafana.

## Comment ça marche

`promtail` découvre tous les conteneurs du compose via le socket Docker et
envoie leurs logs à `loki`. Les services Campify produisent du JSON :
`backend` (API), `ingester`, `worker` (`LOG_FORMAT=json`, voir
`shared/logger.ts`) et `simulator` (`scripts/device/log.ts`). Ce sont les
seuls dont `promtail-config.yml` extrait des labels (`level`, `eventType`,
`status`). Chaque ligne porte un champ `service` qui identifie le process :
`campify-api`, `campify-ingester`, `campify-worker`, `device-simulator`
(`SERVICE_NAME` dans `docker-compose.yml`). Les autres conteneurs
(`postgres`, `mosquitto`, …) restent en texte brut, cherchables dans le
panneau générique mais pas structurés.

Correction J4 : jusqu'ici seul `backend` était analysé, alors que depuis
les ADR 0011/0012 les mesures sont consolidées par le `worker` et les ACK
reçus par l'`ingester`. Les panneaux J3 filtraient donc un service qui ne
produisait plus ces événements. Ils visent désormais
`compose_service=~"backend|ingester|worker"`.

`deviceId`/`eventId`/`commandId`/`reason`/`topic` ne sont **jamais** des labels Loki
(cardinalité trop élevée, un `eventId` est quasi unique par message) — ils
restent dans le corps JSON de chaque ligne, filtrables via `| json` dans
n'importe quelle requête LogQL, par ex. :

```logql
{compose_service=~"backend|ingester|worker"} | json | deviceId="sensor-002" | reason="duplicate"
{compose_service=~"backend|ingester|worker|simulator"} |= "<commandId>" | json
```

## Si le dashboard ne suffit pas

Écrire directement une requête LogQL dans Grafana (Explore, datasource
Loki), ou en dernier recours :

```bash
docker compose logs -f backend
```
