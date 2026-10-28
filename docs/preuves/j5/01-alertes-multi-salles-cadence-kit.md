# Preuve J5 — alertes multi-salles, à la cadence du kit (avant / après correctif ingester)

Reproduire : voir [README.md](README.md), essai A.

Simulateur : 3 salles (sensor-001/002/003), 1 message toutes les 2 s par capteur, QoS 1, pic de CO₂ sur sensor-001 (`--co2-spike sensor-001`, profil 600 → 1200 → 800 ppm sur ~2 min, `scripts/device/co2Scenario.ts`). En parallèle, `scripts/load-check.ts` : 8 clients lisent l'API en continu pendant 150 s.

## Avant correctif : 1 message sur 4 perdu avant l'ingester

Le simulateur a publié 240 messages (confirmés par le broker, QoS 1) ; le journal brut n'en contient que 61 — 19 à 21 par capteur. Aucun rejet, aucun dead-letter, worker à jour (`pending: 0`). Cause : 4 sessions persistantes `campify-ingester-<hostname>` dans le broker (logs mosquitto), dont 3 orphelines laissées par les recréations du conteneur, toutes membres de la souscription partagée → le broker répartit les messages entre les 4, l'ingester vivant n'en reçoit qu'un quart. Voir [docs/J5.md](../../J5.md#comment-identifier-le-composant-en-cause-quand-lécran-ne-se-met-plus-à-jour-).

    Essai du 2026-10-28T09:11:55.136Z — 150 s, 8 clients en lecture, 3 salles
    
    | Lecture | Requêtes | Erreurs | p50 (ms) | p95 (ms) | max (ms) | Taille max (octets) |
    |---|---|---|---|---|---|---|
    | GET /devices/:id/history?type=co2 (24h) | 21527 | 0 | 11 | 16 | 28 | 386 |
    | GET /rooms | 21741 | 0 | 18 | 24 | 98 | 442 |
    | GET /rooms/:id/alerts | 21305 | 0 | 14 | 21 | 75 | 414 |
    | GET /rooms/:id/measurements/latest | 21716 | 0 | 12 | 18 | 32 | 580 |
    
    Délai publication → visible dans l'API (âge de la mesure la plus récente) : p50 6.6 s, p95 14.3 s, max 3475.0 s (222 relevés)
    
    | Salle | Mesures CO₂ consolidées pendant l'essai | Alertes ouvertes pendant l'essai | Détail |
    |---|---|---|---|
    | Salle 203 | 19 | 1 | co2 above_max : ouverte à 1056 (09:12:35), résolue à 857 (09:13:47) |
    | Salle 204 | 19 | 0 | — |
    | Salle 205 | 19 | 0 | — |

## Après correctif (`MQTT_CLIENT_ID` stable, `persistent_client_expiration 1h`)

237 messages publiés, 231 consolidés au moment du bilan (77 par salle). Délai de bout en bout p95 5,4 s (poll worker 3 s + repos 1 s + intervalle d'émission 2 s).

Essai du 2026-10-28T09:17:12.830Z — 150 s, 8 clients en lecture, 3 salles

| Lecture | Requêtes | Erreurs | p50 (ms) | p95 (ms) | max (ms) | Taille max (octets) |
|---|---|---|---|---|---|---|
| GET /devices/:id/history?type=co2 (24h) | 18304 | 0 | 10 | 18 | 36 | 465 |
| GET /rooms | 18557 | 0 | 23 | 37 | 63 | 442 |
| GET /rooms/:id/alerts | 18316 | 0 | 14 | 23 | 42 | 414 |
| GET /rooms/:id/measurements/latest | 18310 | 0 | 15 | 28 | 52 | 580 |

Délai publication → visible dans l'API (âge de la mesure la plus récente) : p50 3.6 s, p95 5.4 s, max 5.7 s (219 relevés)

| Salle | Mesures CO₂ consolidées pendant l'essai | Alertes ouvertes pendant l'essai | Détail |
|---|---|---|---|
| Salle 203 | 77 | 1 | co2 above_max : ouverte à 1050 (09:17:52), résolue à 896 (09:19:03) |
| Salle 204 | 77 | 0 | — |
| Salle 205 | 77 | 0 | — |

**Une seule alerte**, pour la seule salle en pic : ouverte au franchissement de 1000 ppm, aucune nouvelle alerte pendant les ~65 s au-dessus du seuil (~30 mesures hors seuil), retour à la normale à 896 ppm — pas à 999 : l'hystérésis (≤ 900) a joué. Les deux autres salles : 0 alerte.
