# ADR 0009 — Stack de logs centralisés (Loki + Promtail + Grafana)

## Statut

Acceptée.

## Contexte

J3 demande de pouvoir prouver le comportement du système (isolation des
devices, rejets, doublons, retard, coupures MQTT/backend) à partir de logs
recherchables, pas de `docker logs` lus à la main dans plusieurs
terminaux. Les logs applicatifs sont déjà structurés en JSON
(`shared/logger.ts`, `eventType`/`eventId`/`status`/`reason`, voir ADR
0008 et `docs/architecture.md`) — il manquait un endroit où les agréger et
les interroger, intégré au `docker-compose.yml` existant plutôt qu'un
outil externe à installer séparément.

## Décision

- **Loki** (stockage/index des logs) + **Promtail** (collecte) +
  **Grafana** (visualisation), tous les trois dans
  `backend/docker-compose.yml` — un seul `docker compose up -d` suffit,
  cohérent avec l'exigence "reproductible par une personne extérieure au
  groupe sans recherche manuelle dans plusieurs terminaux".
- Promtail découvre **tous** les conteneurs via le socket Docker
  (`docker_sd_configs`) — pas de config par service à maintenir à chaque
  ajout de conteneur.
- Seul le service `backend` est parsé en JSON (`LOG_FORMAT=json`, forcé
  par `docker-compose.yml` indépendamment de `NODE_ENV`, pour ne pas
  changer le confort de `npm run dev` en local où le format reste
  lisible/pino-pretty). Les autres conteneurs restent en texte brut,
  cherchables mais pas structurés — suffisant : ce sont les logs du
  backend qui portent la logique métier à prouver.
- Labels Loki limités à `level`/`eventType`/`status` (faible cardinalité,
  valeurs bornées). `deviceId`/`eventId`/`reason`/`topic` restent dans le
  corps JSON, filtrables via `| json` en LogQL — jamais en label, sous
  peine d'expliquer l'index Loki avec un `eventId` quasi unique par
  message.
- Dashboard Grafana **provisionné automatiquement** (pas de configuration
  manuelle après démarrage) avec les filtres demandés par J3 : événements
  d'un device donné, messages rejetés, doublons détectés, données
  anciennes/en retard, erreurs/coupures de connexion MQTT — voir
  `backend/observability/README.md`.
- Auth Grafana désactivée (accès anonyme) : stack locale/démo uniquement,
  jamais exposée publiquement.

## Alternatives envisagées

- **`docker compose logs` / lecture manuelle des conteneurs** : rejeté
  comme solution finale — fonctionne pour une preuve isolée mais pas pour
  corréler plusieurs conteneurs sur un même incident (ex. coupure broker +
  comportement backend), et ne remplit pas l'exigence explicite de J3.
- **ELK (Elasticsearch/Logstash/Kibana)** : plus lourd (JVM, RAM
  significativement supérieure à Loki qui n'indexe que les labels, pas le
  texte intégral) pour un besoin de prototype/démo — écarté, Loki suffit
  et démarre plus vite.
- **Loki Docker driver plugin** (`grafana/loki-docker-driver`) au lieu de
  Promtail : évite un conteneur de plus, mais s'installe comme plugin du
  daemon Docker de la machine hôte — pas reproductible uniquement via
  `docker compose up`, écarté pour cette raison.

## Conséquences

- Trois conteneurs de plus au démarrage (`loki`, `promtail`, `grafana`) —
  acceptable pour un usage local/démo, pas pensé pour une volumétrie de
  production (config Loki mono-instance, stockage filesystem local, pas de
  rétention configurée au-delà des valeurs par défaut).
- Le format JSON forcé en conteneur (`LOG_FORMAT=json`) diverge du format
  par défaut hors conteneur (`pino-pretty`) — voulu, mais un point à ne
  pas oublier si `LOG_LEVEL`/`LOG_FORMAT` sont un jour déplacés dans le
  schéma de config validé (`shared/config.ts`) plutôt que lus directement
  depuis `process.env` dans `shared/logger.ts`.
- Preuves à produire une fois la stack lancée : captures Grafana pour
  chaque scénario J3 obligatoire, avec la requête LogQL utilisée —
  `docs/J3.md`.
