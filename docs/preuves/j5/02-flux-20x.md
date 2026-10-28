# Preuve J5 — flux 20 fois plus important

Même essai que [01](01-alertes-multi-salles-cadence-kit.md), simulateur à `--interval 100` : 30 messages/s, 60 mesures/s (3 capteurs × 2 métriques), 4 473 messages en 150 s. Machine locale unique (Docker Desktop, Windows 11).

Essai du 2026-10-28T09:20:00.965Z — 150 s, 8 clients en lecture, 3 salles

| Lecture | Requêtes | Erreurs | p50 (ms) | p95 (ms) | max (ms) | Taille max (octets) |
|---|---|---|---|---|---|---|
| GET /devices/:id/history?type=co2 (24h) | 4258 | 0 | 12 | 29 | 206 | 560 |
| GET /rooms | 4296 | 0 | 105 | 333 | 668 | 442 |
| GET /rooms/:id/alerts | 4206 | 0 | 16 | 36 | 249 | 415 |
| GET /rooms/:id/measurements/latest | 4154 | 0 | 85 | 281 | 475 | 583 |

Délai publication → visible dans l'API (âge de la mesure la plus récente) : p50 3.6 s, p95 4.9 s, max 5.1 s (183 relevés)

| Salle | Mesures CO₂ consolidées pendant l'essai | Alertes ouvertes pendant l'essai | Détail |
|---|---|---|---|
| Salle 203 | 1439 | 1 | co2 above_max : ouverte à 1001 (09:20:38), résolue à 893 (09:21:50) |
| Salle 204 | 1438 | 0 | — |
| Salle 205 | 1439 | 0 | — |

Recompte après la fin de la consolidation (base vérifiée, CO₂ depuis le début de l'essai) : **1 505 mesures par capteur**, pour 1 524 publiées dont ~19 avant le départ du script — **aucune perte**, 0 dead-letter. Le bilan du script (1 439) était pris pendant que le worker consolidait encore les dernières secondes.

Observations :

- **Alertes** : toujours **une seule** alerte pour la salle en pic sur ~1 500 mesures (dont ~650 hors seuil), 0 ailleurs.
- **Historique 24h** : réponse de 560 octets max, p95 29 ms — l'agrégation par intervalles rend sa taille indépendante du débit (avant : les 500 dernières mesures brutes, soit ~25 s de données à ce débit).
- **Délai de bout en bout** inchangé (p95 4,9 s) : le worker absorbe 60 mesures/s par lots, sans retard cumulé.
- **Point faible** : `GET /rooms` et `/rooms/:id/measurements/latest` passent à p95 ~300 ms (contre ~30 ms) — elles font une requête « dernière mesure par type » par device, en concurrence avec les insertions. Acceptable pour un téléphone qui rafraîchit toutes les 30 s ; à optimiser (agrégat continu TimescaleDB ou cache) avant de multiplier les salles. Voir limites dans [docs/J5.md](../../J5.md).

Ressources juste après l'essai (`docker stats`) : ingester 56 Mo, worker 51 Mo, API 104 Mo, PostgreSQL 189 Mo.
