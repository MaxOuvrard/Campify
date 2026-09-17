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
- **Loki** (API brute) : [http://localhost:3100](http://localhost:3100),
  rarement utile directement — passer par Grafana.

## Comment ça marche

`promtail` découvre tous les conteneurs du compose via le socket Docker et
envoie leurs logs à `loki`. Seul le service `backend` produit du JSON
(`LOG_FORMAT=json`, voir `shared/logger.ts`) : c'est le seul dont
`promtail-config.yml` extrait des labels (`level`, `eventType`, `status`).
Les autres conteneurs (`postgres`, `mosquitto`, …) restent en texte brut,
cherchable dans le panneau générique mais pas structuré.

`deviceId`/`eventId`/`reason`/`topic` ne sont **jamais** des labels Loki
(cardinalité trop élevée, un `eventId` est quasi unique par message) — ils
restent dans le corps JSON de chaque ligne, filtrables via `| json` dans
n'importe quelle requête LogQL, par ex. :

```logql
{compose_service="backend"} | json | deviceId="sensor-002" | reason="duplicate"
```

## Si le dashboard ne suffit pas

Écrire directement une requête LogQL dans Grafana (Explore, datasource
Loki), ou en dernier recours :

```bash
docker compose logs -f backend
```
