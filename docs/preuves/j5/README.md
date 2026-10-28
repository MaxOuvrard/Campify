# Preuves J5 — reproduire

Prérequis : stack lancée et seedée (voir [README racine](../../../README.md), étapes 1 et 2).

| Preuve | Jalon |
|---|---|
| [01 — Alertes multi-salles, cadence du kit](01-alertes-multi-salles-cadence-kit.md) | Alertes qui ne se multiplient pas ; plusieurs salles ; incident « perte de messages » diagnostiqué et corrigé |
| [02 — Flux 20× plus important](02-flux-20x.md) | Lectures d'historique bornées sous flux important |
| [03 — Suivi d'une mesure](03-suivi-d-une-mesure.md) | Une mesure suivie dans les traces |
| [04 — Suivi d'une commande](04-suivi-d-une-commande.md) | Une commande suivie dans les traces |
| [Accessibilité mobile](../accessibilite-mobile.md) | Lisibilité, contraste, libellés, erreurs |

## Essai A — cadence du kit (preuve 01)

Deux terminaux, depuis `backend/`, lancés à quelques secondes d'intervalle :

```bash
npx tsx scripts/simulate-devices.ts --password changeme-local-only --co2-spike sensor-001 --interval 2000 --qos 1
npx tsx scripts/load-check.ts --duration 150 --concurrency 8
```

Attendu : Salle 203 → **1** alerte CO₂ ouverte puis résolue ; Salles 204 et 205 → **0** ;
~75 mesures consolidées par salle.

## Essai B — flux 20× (preuve 02)

Idem avec `--interval 100` côté simulateur. Attendu : toujours 1 / 0 / 0 alerte,
~1 500 mesures par salle, réponse de l'historique 24h de taille constante (< 1 ko).

Pour un recompte exact après la fin de la consolidation :

```bash
docker compose exec -T postgres psql -U campify -d campify -tAc \
  "SELECT \"deviceId\", count(*) FROM \"Measurement\" WHERE type='co2' AND timestamp >= '<début de l''essai>' GROUP BY 1;"
```

## Suivi d'une mesure / d'une commande (preuves 03, 04)

- Mesure : Grafana → *Campify — Logs backend* → variable `eventId` = un `message_id`
  (affiché par le simulateur) → panneau *Suivi d'une mesure*.
- Commande : se connecter en `operateur@campify.local`, envoyer une commande
  (app mobile, ou `POST /devices/sensor-002/commands` avec un en-tête
  `Idempotency-Key`), puis `npm run trace:command -- <commandId>`. Pour que les
  étapes « côté objet » apparaissent aussi dans Loki, lancer le simulateur en
  conteneur : `docker compose --profile simulator up -d --build simulator`.
