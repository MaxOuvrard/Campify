# ADR 0004 — Contrat MQTT : placeholder en attendant le kit IoT

## Statut

Partiellement mise à jour le 2026-09-15 : le contrat de **télémétrie**
(topic + payload) a été observé sur le broker de démonstration du kit
(MQTT plain TCP). **Correction J3** : cette section exposait jusqu'ici
l'adresse et les identifiants réels du broker en clair dans ce fichier
commité — retirés (voir `docs/J3.md`, audit secrets). À demander à
l'équipe et à ne conserver que dans un `.env` local, jamais dans un
fichier versionné. Le contrat de **commandes/acquittements** reste un
placeholder non vérifié — aucune commande n'a été publiée vers le kit
pour confirmer sa forme (voir « Ce qui reste en placeholder »
ci-dessous).

## Contexte

Le sujet mentionne un « contrat MQTT du kit » qui impose la forme des
topics et des messages. Ce contrat n'était pas disponible au moment de la
mise en place du backend. Pour ne pas bloquer l'implémentation de
l'architecture (domaine, adapters, tests), des conventions plausibles ont
été posées, clairement isolées pour être remplacées sans impact sur le
domaine.

## Décision — contrat de télémétrie (confirmé)

Observé en s'abonnant en lecture seule à `campus/v1/devices/+/telemetry`
sur le broker de démonstration (aucune commande n'a été publiée : les
actions d'écriture vers un système réel restent soumises à validation).

- Topic, défini dans `backend/src/shared/mqttTopics.ts` :
  `{prefix}/v1/devices/{deviceId}/telemetry` (préfixe `campus` par défaut,
  configurable via `MQTT_TOPIC_PREFIX`).
- Payload, validé par Zod dans `backend/src/driving/mqtt/schemas.ts` — une
  enveloppe commune + une ou plusieurs métriques nommées :
  ```json
  {
    "schema_version": 1,
    "message_id": "80da77ef1c964ffc971f34494346d93e-4776",
    "device_id": "sensor-001",
    "room_id": "salle-203",
    "observed_at": "2026-09-15T11:24:17.206Z",
    "temperature": { "value": 21.7, "unit": "°C" },
    "co2": { "value": 2500, "unit": "ppm" }
  }
  ```
  `device_id`/`room_id` du payload sont redondants avec le topic (le
  device est déjà résolu depuis le topic) et ne sont pas exploités.
  L'adapter (`driving/mqtt/handlers.ts`) éclate le message en un appel
  `MeasurementIngestionService.ingest()` par métrique présente
  (`extractMetrics`), sans changement du domaine.
- Deux autres topics existent sur le broker mais ne sont pas encore
  consommés côté backend (pas de port/besoin métier identifié) :
  `{prefix}/v1/devices/{deviceId}/availability` (statut en ligne/hors
  ligne) et `{prefix}/v1/devices/{deviceId}/state` (état interne, ex.
  `ventilation`).

## Ce qui reste en placeholder

- Commandes/acquittements dans `backend/src/shared/mqttTopics.ts` :
  - Émission de commande (publish) : `{prefix}/devices/{deviceId}/commands`
  - Acquittement de commande : `{prefix}/devices/{deviceId}/commands/ack`
  - Payload d'acquittement, `backend/src/driving/mqtt/schemas.ts` :
    ```json
    { "commandId": "uuid", "acknowledgedAt": "2024-01-01T00:00:00.000Z" }
    ```
  Non vérifiés : publier une commande vers le kit modifierait un système
  partagé, ce qui n'a pas été fait. À revoir dès qu'une commande réelle
  (et son ack) auront pu être observés.
- Les seuils d'alerte dans `backend/src/composition.ts`
  (`alertThresholds`, actuellement vide) — à définir maintenant que les
  types de métriques réels (`temperature`, `co2`) et leurs unités sont
  connus.

Le domaine (`MeasurementIngestionService`, `CommandService`, dédup,
fraîcheur, alertes) n'a **aucune** raison de changer : il consomme des
types du domaine (`NewMeasurement`, `Command`), pas des payloads MQTT
bruts. Voir [[0001-architecture-hexagonale]].
