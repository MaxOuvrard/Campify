# ADR 0004 — Contrat MQTT : placeholder en attendant le kit IoT

## Statut

Acceptée à titre provisoire — **à revoir dès que le contrat exact du kit
IoT (topics, forme des payloads) est connu.**

## Contexte

Le sujet mentionne un « contrat MQTT du kit » qui impose la forme des
topics et des messages. Ce contrat n'était pas disponible au moment de la
mise en place du backend. Pour ne pas bloquer l'implémentation de
l'architecture (domaine, adapters, tests), des conventions plausibles ont
été posées, clairement isolées pour être remplacées sans impact sur le
domaine.

## Décision (placeholder)

- Topics, définis dans `backend/src/shared/mqttTopics.ts` :
  - Mesures entrantes : `campify/rooms/{roomId}/devices/{deviceId}/measurements`
  - Acquittement de commande : `campify/devices/{deviceId}/commands/ack`
  - Émission de commande (publish) : `campify/devices/{deviceId}/commands`
- Payload de mesure, validé par Zod dans `backend/src/driving/mqtt/schemas.ts` :
  ```json
  { "type": "temperature", "value": 21.5, "unit": "C", "timestamp": "2024-01-01T00:00:00.000Z" }
  ```
- Payload d'acquittement de commande :
  ```json
  { "commandId": "uuid", "acknowledgedAt": "2024-01-01T00:00:00.000Z" }
  ```
- Le préfixe `campify` est configurable via `MQTT_TOPIC_PREFIX`.

## Ce qui devra changer une fois le contrat réel connu

- `backend/src/shared/mqttTopics.ts` (noms de topics, structure des segments)
- `backend/src/driving/mqtt/schemas.ts` (schémas Zod : types de mesures
  réels, unités, éventuels champs supplémentaires)
- Les seuils d'alerte dans `backend/src/composition.ts`
  (`alertThresholds`, actuellement vide)

Le domaine (`MeasurementIngestionService`, `CommandService`, dédup,
fraîcheur, alertes) n'a **aucune** raison de changer : il consomme des
types du domaine (`NewMeasurement`, `Command`), pas des payloads MQTT
bruts. Voir [[0001-architecture-hexagonale]].
