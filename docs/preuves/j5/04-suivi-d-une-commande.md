# Preuve J5 — suivre une commande dans les traces

Commande `set_ventilation { on: true }` envoyée par `operateur@campify.local` à sensor-002 (simulateur en mode normal), puis `npm run trace:command -- 3ce7ccdf-79cf-489d-8412-e50a72956b35 --since 10m` (script J4, ADR 0014).

```

=== Parcours de la commande 3ce7ccdf-79cf-489d-8412-e50a72956b35 (5 lignes de log) ===

  09:24:21.855  campify-api       command request received                                   received  idempotencyKey=j5-preuve-1793179461
  09:24:21.864  campify-api       command accepted                                           PENDING  idempotencyKey=j5-preuve-1793179461
  09:24:21.869  campify-ingester  command ack received                                       ack_received  ackStatus=executed
  09:24:21.871  campify-api       command published                                          SENT  transitionApplied=true
  09:24:21.936  campify-ingester  command acknowledged by device                             ACKNOWLEDGED  ackStatus=executed latencyMs=78

=== Étapes ===

  [x] Demande reçue par l'API
  [x] Commande persistée (PENDING)
  [x] Publiée sur MQTT, confirmée par le broker (SENT)
  [ ] Reçue par l'objet
  [ ] Exécutée par l'objet
  [ ] ACK émis par l'objet
  [x] ACK reçu par le backend (ingester)
  [x] État mis à jour par l'ACK (ACKNOWLEDGED / FAILED)

  → Chaîne interrompue à l'étape : « Reçue par l'objet »

=== État persisté (base vérifiée) ===

  {
    "status": "ACKNOWLEDGED",
    "type": "set_ventilation",
    "params": {
      "on": true
    },
    "createdAt": "2026-10-28T09:24:21.858Z",
    "expiresAt": "2026-10-28T09:24:36.857Z",
    "sentAt": "2026-10-28T09:24:21.865Z",
    "ackedAt": "2026-10-28T09:24:21.866Z",
    "timedOutAt": null,
    "failureReason": null,
    "reportedState": {
      "ventilation": "on",
      "target_temperature": null
    },
    "lateAckStatus": null,
    "lateAckAt": null
  }
```

Les trois étapes « côté objet » ne sont pas cochées par le script uniquement parce que le simulateur tournait hors Docker (ses logs ne passent pas par Promtail). Ses lignes, même `commandId` :

```
66,"service":"device-simulator","msg":"command executed","eventType":"command_lifecycle","deviceId":"sensor-002","delivery":"first","commandId":"3ce7ccdf-79cf-489d-8412-e50a72956b35","commandType":"set_ventilation","params":{"on":true},"status":"executed","sta
{"level":30,"time":1793179461867,"service":"device-simulator","msg":"ack sent","eventType":"command_lifecycle","deviceId":"sensor-002","commandId":"3ce7ccdf-79cf-489d-8412-e50a72956b35","delivery":"first","ackStatus":"executed","status":"ack_sent"}
```

À noter dans l'ordre des lignes : l'ACK est reçu par l'ingester (09:24:21.869) **avant** que l'API ait journalisé la publication (.871) — le device a répondu pendant que l'API attendait le PUBACK. Le statut final est quand même ACKNOWLEDGED : la transition conditionnelle (ADR 0014) empêche l'écriture tardive de SENT d'écraser l'ACK.
