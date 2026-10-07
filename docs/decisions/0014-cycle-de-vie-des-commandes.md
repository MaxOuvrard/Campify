# ADR 0014 — Commandes : contrat, cycle de vie, timeouts et idempotence

## Statut

En cours (J4). Sections « Contrat » et « Cycle de vie et timeout »
acceptées ; la section « Idempotence » est complétée au fil de J4.

## Contexte

J4 : depuis le mobile, un utilisateur demande une action à un objet (ex.
activer la ventilation). Le système doit distinguer **la demande envoyée**
de **l'action réellement exécutée** par l'objet, dans un système distribué
où chaque maillon (backend, broker MQTT, objet, réseau) peut tomber,
retarder ou dupliquer un message.

L'existant avant J4 était un embryon : `POST /devices/:id/commands`
publiait n'importe quel `type`/`payload` tel quel, l'ACK ne portait qu'un
`commandId` sans dire si l'objet avait exécuté ou refusé la commande, et
le `deviceId` du topic d'ACK n'était jamais comparé à celui de la
commande.

Vocabulaire : un **ACK** (*acknowledgement*, accusé de réception) est le
message que l'objet renvoie au backend en réponse à une commande. Le
`command_id`, généré par le backend et recopié par l'objet dans son ACK,
est ce qui permet de **corréler** une réponse à la bonne commande.

## Décision — Contrat

### Topics

Alignés sur la convention `v1` de la télémétrie réelle du kit
(`shared/mqttTopics.ts`) :

| Sens | Topic | QoS |
|---|---|---|
| backend → objet | `{prefix}/v1/devices/{deviceId}/commands` | 1 |
| objet → backend | `{prefix}/v1/devices/{deviceId}/commands/ack` | 1 (souscription ingester) |

L'ACL du broker local (`backend/mosquitto.acl`) restreint chaque objet à
la lecture de **ses** commandes et à l'écriture de **ses** ACK.

### Commande (backend → objet)

```json
{
  "schema_version": 1,
  "command_id": "8f1c2c9e-…",
  "device_id": "sensor-001",
  "type": "set_ventilation",
  "params": { "on": true },
  "created_at": "2026-10-07T10:00:00.000Z",
  "expires_at": "2026-10-07T10:00:15.000Z"
}
```

- `snake_case`, comme la télémétrie du kit.
- `expires_at` = `created_at` + `COMMAND_ACK_TIMEOUT_MS` (15 s par
  défaut). Au-delà, l'objet **ne doit pas exécuter** la commande et répond
  `expired`. Raison : l'ingester utilise une session persistante en QoS 1
  (ADR 0010) et l'objet peut en faire autant. Un objet hors ligne peut
  donc recevoir la commande **plusieurs minutes plus tard**, alors que le
  backend l'a déjà abandonnée et que l'utilisateur a vu « échec ». Sans
  `expires_at`, la ventilation s'allumerait alors sans que personne ne
  l'attende.

### ACK (objet → backend)

```json
{
  "schema_version": 1,
  "command_id": "8f1c2c9e-…",
  "status": "executed",
  "reason": null,
  "state": { "ventilation": "on" },
  "acked_at": "2026-10-07T10:00:01.200Z"
}
```

- `status` : `executed` (exécutée), `rejected` (refusée par l'objet,
  `reason` explique pourquoi), `expired` (reçue après `expires_at`, non
  exécutée).
- L'ACK n'est émis **qu'après exécution** : `executed` signifie « c'est
  fait », jamais seulement « reçu ».
- `state` : état réel de l'objet après traitement, conservé
  (`Command.reportedState`) comme preuve.
- Le device est résolu **depuis le topic**, pas depuis le payload
  (ADR 0008). Un ACK dont le topic ne correspond pas au device de la
  commande est rejeté (`reason: device_mismatch`) : connaître un
  `command_id` ne suffit pas pour acquitter la commande d'un autre objet.

### Liste blanche des commandes

Règle métier, donc dans le domaine (`domain/services/commandCatalog.ts`) :

| `type` | `params` |
|---|---|
| `set_ventilation` | `{ "on": boolean }` |
| `set_target_temperature` | `{ "value": number }`, entre 10 et 30 °C |

Tout autre type ou paramètre est refusé (HTTP 400) **avant** persistance
et publication. Les champs inconnus sont retirés. Rien d'arbitraire ne
part vers un objet physique.

### Alternatives écartées

- **Double ACK** (« reçue » puis « exécutée ») : plus fin, mais il double
  les cas d'incertitude à gérer (reçu sans exécuté, exécuté sans reçu
  perdu…), pour un gain faible sur des actions quasi instantanées. Un
  seul ACK, post-exécution, porteur du résultat.
- **Garder `campus/devices/...` sans `v1`** : deux conventions de topics
  coexisteraient pour le même objet.
- **Valider le type de commande dans la route** : la règle serait
  dupliquée le jour où une autre entrée (ex. règle automatique) émettra des
  commandes. Elle est donc portée par le domaine (voir CLAUDE.md).

## Décision — Cycle de vie et timeout

### États

```
                       publication confirmée (PUBACK)
   ┌─────────┐  ─────────────────────────────────►  ┌──────┐   ACK "executed"   ┌──────────────┐
   │ PENDING │                                       │ SENT │ ─────────────────► │ ACKNOWLEDGED │
   └─────────┘                                       └──────┘                    └──────────────┘
     │  │  │  client MQTT déconnecté :                 │  │  ACK "rejected"/"expired" ┌────────┐
     │  │  └─ rien n'est parti ───────────────────────────────────────────────────► │ FAILED │
     │  │                                              │                            └────────┘
     │  └─ ACK (publication non confirmée mais reçue) ─┴──► ACKNOWLEDGED / FAILED
     │                                                 │                            ┌─────────┐
     └──────── aucun ACK après expires_at + grâce ─────┴──────────────────────────► │ TIMEOUT │
                                                                                    └─────────┘
```

| État | Ce que le backend **sait** | Ce qu'il **ne sait pas** |
|---|---|---|
| `PENDING` | la demande est valide et persistée | si elle est partie vers le broker |
| `SENT` | le broker l'a acceptée (PUBACK QoS 1) | si l'objet l'a reçue |
| `ACKNOWLEDGED` | l'objet affirme l'avoir exécutée, avec l'état résultant | — |
| `FAILED` | elle n'a **pas** été exécutée (refus ou expiration côté objet, ou rien n'est parti) | — |
| `TIMEOUT` | aucune réponse dans le délai | si l'objet l'a exécutée — **c'est l'incertitude** |

`ACKNOWLEDGED`, `FAILED` et `TIMEOUT` sont **terminaux** : aucune
transition n'en sort. Le seul enrichissement possible d'un `TIMEOUT` est
l'enregistrement d'un ACK tardif (voir plus bas).

### Transitions atomiques

Trois process peuvent viser la même commande au même instant : l'API
(`PENDING → SENT/FAILED`), l'ingester (ACK) et le worker (timeout). Chaque
transition est un `UPDATE … WHERE id = ? AND status IN (états de départ
autorisés)` (`CommandRepository.transition()`, qui renvoie `false` s'il n'a
rien modifié). Un seul gagne, et les autres le constatent au lieu
d'écraser son résultat. Cas couverts par des tests :

- **ACK plus rapide que le PUBACK** : l'objet répond avant que l'API ait
  marqué `SENT`. La commande est `ACKNOWLEDGED`, et le passage
  `PENDING → SENT` de l'API échoue sans effet, sans retour en arrière.
- **ACK et timeout simultanés** : le premier arrivé gagne. Si c'est l'ACK,
  le worker abandonne. Si c'est le timeout, l'ACK devient un ACK tardif.

### Publication : ne conclure que sur une certitude

`MqttPublisher.publishCommand()` renvoie ce que l'adapter **sait**, sans
plus :

| Issue | Situation | État |
|---|---|---|
| `confirmed` | PUBACK du broker reçu | `SENT` |
| `not_sent` | client MQTT déconnecté : on **ne publie pas** (sinon mqtt.js mettrait la commande en file et l'enverrait à la reconnexion, plus tard que prévu) | `FAILED` (`broker_unavailable`) |
| `unconfirmed` | ni PUBACK ni erreur sous `COMMAND_PUBLISH_CONFIRM_TIMEOUT_MS` (5 s), ou erreur | reste `PENDING` : la commande a **pu** partir. Un ACK peut encore la conclure, sinon le timeout le fera |

`POST /devices/:id/commands` répond **`202 Accepted`** (demande acceptée,
traitement asynchrone) et non `201 Created`. Le client suit ensuite l'état
via `GET /commands/:id`.

### Timeout

- **Échéance** : `expires_at` (création + `COMMAND_ACK_TIMEOUT_MS`, 15 s),
  à laquelle s'ajoute une **grâce** `COMMAND_TIMEOUT_GRACE_MS` (5 s). La
  grâce laisse à l'ACK d'une commande exécutée juste avant `expires_at` le
  temps de traverser le broker. L'objet, lui, n'exécute jamais une commande
  après `expires_at`.
- **Qui le déclare** : le **worker**, par balayage toutes les
  `COMMAND_TIMEOUT_SWEEP_INTERVAL_MS` (2 s). La règle est dans
  `domain/services/CommandTimeoutService.ts`, et le déclenchement dans
  `driving/worker/commandTimeoutPoller.ts`. Le worker est en instance
  unique et n'a pas de client MQTT. Comme l'échéance vit en base, un
  redémarrage ne perd rien.
- **Motifs** journalisés : `no_ack` (commande `SENT`) ou
  `no_ack_publish_unconfirmed` (commande restée `PENDING`).

Alternatives écartées :
- **`setTimeout` en mémoire dans l'API** : perdu au redémarrage, et faux à
  plusieurs instances (l'instance qui a émis n'est pas forcément vivante
  à l'échéance).
- **Calcul « à la lecture »** (le GET déduit `TIMEOUT` si l'échéance est
  passée) : aucun événement de timeout dans les logs, impossible à prouver
  ou à filtrer par `commandId`. Le statut en base ne refléterait pas non
  plus ce que l'API affiche.

### ACK arrivé après le timeout

La commande **reste `TIMEOUT`** : c'est ce que l'utilisateur a vu, et
deux lectures successives ne doivent pas dire deux choses contradictoires.
L'ACK n'est pas pour autant ignoré. Son statut et sa date sont conservés
(`Command.lateAck`, exposé par l'API), ainsi que l'état rapporté
(`reportedState`). L'événement est journalisé avec `reason: late_ack`. Le
mobile peut donc afficher « Expirée — l'objet a finalement confirmé à … ».
Seul le premier ACK tardif est conservé.

Grâce à `expires_at`, un ACK tardif `executed` ne peut venir que d'un ACK
**retardé en transit** (exécution avant l'échéance, réponse arrivée après
la grâce). Un objet qui reçoit la commande trop tard répond `expired`, sans
l'exécuter.

Alternative écartée : repasser la commande en `ACKNOWLEDGED` (« la vérité
gagne »). L'état final changerait après coup, et le mobile aurait déjà
annoncé un échec. On préfère un état stable, accompagné de l'information
tardive explicite.

### ACK sur une commande déjà conclue

Un ACK reçu pour une commande déjà `ACKNOWLEDGED` ou `FAILED` n'a **aucun
effet**. Le premier ACK fait foi. L'événement est journalisé avec
`reason: duplicate_ack`. Le détail de l'idempotence est traité dans la
section suivante.

## Limites connues

- Contrat défini par l'équipe, **non vérifié contre le kit réel** :
  aucune commande n'a été publiée vers le broker partagé du kit (voir
  ADR 0004). Un écart ne toucherait que `shared/mqttTopics.ts`,
  `driving/mqtt/schemas.ts` et `infra/mqtt/MqttCommandPublisher.ts`.
- `expires_at` suppose des horloges objet/backend raisonnablement
  synchronisées (NTP). Un objet en avance de plus de 15 s rejetterait
  tout en `expired`.

## Conséquences

- Migration `20261009090000_command_contract` : `payload` → `params`
  (obligatoire), ajout de `expiresAt`, `failureReason`, `reportedState`.
- Migration `20261009100000_command_lifecycle` : `ACKED` → `ACKNOWLEDGED`,
  ajout de `TIMEOUT`, `timedOutAt`, `lateAckStatus`/`lateAckAt`, index
  `(status, expiresAt)` pour le balayage.
- `CommandService` reçoit un `Logger` : chaque transition est journalisée
  (`eventType: command_lifecycle`, `commandId`, `status`, `reason`) par le
  domaine, à la source qui la décide.
- Le simulateur et tout futur firmware doivent respecter ce contrat.

Voir aussi : [[0004-contrat-mqtt-placeholder]], [[0008-identite-devices-authentification-mqtt]],
[[0010-session-mqtt-persistante]], [[0011-worker-consolidation-polling]].
