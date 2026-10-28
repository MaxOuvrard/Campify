# Preuve J5 — suivre une mesure dans les traces

Mesure choisie : celle qui a **ouvert l'alerte** de l'essai [02](02-flux-20x.md). `eventId` = `message_id` MQTT = `6c2fa5b1f9fd482fa7f242378c16fc32-367`.

## 1. Publication (simulateur, stdout)

```
{"level":30,"time":1793179238246,"service":"device-simulator","msg":"telemetry published","eventType":"telemetry","deviceId":"sensor-001","eventId":"6c2fa5b1f9fd482fa7f242378c16fc32-367","status":"published","temperature":20.31,"co2":1001,"ventilation":"off"}
```

## 2. Réception (journal brut MongoDB, écrit par l'ingester — qui ne journalise pas les succès, ADR 0013)

```
{
  _id: ObjectId('6ae1be66606ffd250a2584f5'),
  topic: 'campus/v1/devices/sensor-001/telemetry',
  qos: 1,
  receivedAt: ISODate('2026-10-28T09:20:38.246Z')
}
```

## 3. Consolidation et alerte (Loki, requête `{compose_service=~"backend|ingester|worker|simulator"} |= "<eventId>"`)

```
worker     measurement ingested {'eventType': 'measurement_ingestion', 'status': 'ingested', 'type': 'temperature', 'value': 20.31}
worker     measurement ingested {'eventType': 'measurement_ingestion', 'status': 'ingested', 'type': 'co2', 'value': 1001}
worker     alert opened {'eventType': 'alert', 'status': 'opened', 'type': 'co2', 'value': 1001, 'reason': 'above_max', 'threshold': 1000}
```

Dans Grafana : dashboard *Campify — Logs backend*, variable **eventId**, panneau **Suivi d'une mesure ($eventId)**. Les deux métriques du message (température, CO₂) partagent l'`eventId` ; la ligne `alert opened` porte le même, ce qui relie l'alerte à la mesure qui l'a provoquée.
