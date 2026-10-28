# ADR 0014 — Commandes : contrat, cycle de vie, timeouts et idempotence

## Statut

Acceptée (J4) : contrat, cycle de vie et timeout, idempotence. La
déduplication côté objet (section « Idempotence », point 2) est implémentée
dans le simulateur (`backend/scripts/simulate-devices.ts`), et tout
firmware réel devra la reproduire.

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
  commandes. Elle est donc portée par le domaine (voir [ADR 0001](0001-architecture-hexagonale.md)).

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
(`Command.lateAck`, exposé par l'API ; `lateAck.at` est l'`acked_at`
déclaré par l'objet, c'est-à-dire l'heure d'exécution, pas l'heure de
réception de l'ACK), ainsi que l'état rapporté
(`reportedState`). L'événement est journalisé avec `reason: late_ack`. Le
mobile affiche donc « L'objet a finalement répondu après le délai :
commande exécutée à … ».
Seul le premier ACK tardif est conservé.

Grâce à `expires_at`, un ACK tardif `executed` ne peut venir que d'un ACK
**retardé en transit** (exécution avant l'échéance, réponse arrivée après
la grâce). Un objet qui reçoit la commande trop tard répond `expired`, sans
l'exécuter.

Alternative écartée : repasser la commande en `ACKNOWLEDGED` (« la vérité
gagne »). L'état final changerait après coup, et le mobile aurait déjà
annoncé un échec. On préfère un état stable, accompagné de l'information
tardive explicite.

## Décision — Idempotence

Une opération est **idempotente** si l'exécuter deux fois a le même effet
que l'exécuter une fois. Dans un système distribué, les doublons sont la
norme et non l'exception : MQTT QoS 1 garantit « au moins une fois », un
réseau mobile perd des réponses, et un client réessaie. Un doublon peut
naître à trois endroits, et chacun a sa parade :

```
 Téléphone ──(1)──► Backend ──── commande ──(2)──► Objet
                    Backend ◄─── ACK ───────(3)─── Objet
```

### 0. Filet de dernier recours : des commandes en état cible

Toute commande fixe un **état cible absolu** (`set_ventilation { on: true }`,
`set_target_temperature { value: 21 }`), jamais une variation
(`toggle_ventilation`, `+1 °C`). Exécutée deux fois, une commande absolue
laisse le même état. Une variation, elle, s'annulerait (toggle) ou se
cumulerait (+2 °C) **silencieusement**. Cette règle est imposée par la
liste blanche (`commandCatalog.ts`) : ajouter une commande relative
demanderait de revenir sur cet ADR.

### 1. Demande rejouée par le client : `Idempotency-Key`

Cas : double appui, ou requête arrivée au backend mais réponse perdue
(tunnel, 4G), après quoi le client réessaie.

- `POST /devices/:id/commands` exige un en-tête `Idempotency-Key`. Le
  client génère un UUID **par intention de l'utilisateur** (un appui) et le
  **réutilise à l'identique** pour chaque nouvel essai de cette même
  intention.
- La clé est enregistrée avec la commande, avec une contrainte unique
  `(requestedBy, idempotencyKey)` (une clé est propre à chaque
  utilisateur).

| Situation | Réponse |
|---|---|
| Clé jamais vue | commande créée et publiée, **`202 Accepted`** |
| Même clé, même demande (device, type, params) | **aucune** création ni publication. La commande existante est renvoyée dans son **état courant** : **`200`** + en-tête `Idempotent-Replayed: true`, log `reason: duplicate_request` |
| Même clé, demande différente | **`409 Conflict`** (erreur du client) |
| Pas de clé | **`400`** (`idempotency_key_required`) |
| Deux requêtes identiques **simultanées** | la contrainte unique en base n'en laisse passer qu'une. L'autre récupère la commande créée (`createIfAbsent`) |

La clé est **obligatoire**. Facultative, elle laisserait passer exactement
le doublon qu'elle doit empêcher. On enregistre aussi `requestedBy`
(l'utilisateur), pour la traçabilité.

### 2. Commande reçue deux fois par l'objet : dédup par `command_id`

Cas : le broker redélivre la commande (QoS 1, accusé de l'objet perdu,
session persistante), avec le **même** `command_id`.

- L'objet garde en mémoire les `command_id` déjà traités **et l'ACK
  qu'il a renvoyé**.
- Sur une commande déjà vue, il **ne l'exécute pas à nouveau** mais
  **renvoie le même ACK**. Il n'ignore pas le doublon : la redélivrance
  vient souvent de ce que quelque chose s'est perdu en route, et si
  c'était l'ACK, le renvoyer est le seul moyen pour le backend d'apprendre
  que c'est fait. Si le backend l'avait déjà reçu, le point 3 rend ce
  second ACK sans effet.
- La mémoire est bornée **naturellement par `expires_at`** : passé cette
  date, l'objet répondrait `expired` de toute façon, donc il peut oublier
  la commande.

### 3. ACK reçu deux fois par le backend : le premier fait foi

Un ACK pour une commande déjà `ACKNOWLEDGED` ou `FAILED` n'a **aucun
effet** (transition conditionnelle refusée). L'événement est journalisé
avec `reason: duplicate_ack`. Sur une commande en `TIMEOUT`, seul le
premier ACK tardif est conservé (voir plus haut).

### Nouvel essai après un échec ou un timeout

Un nouvel appui de l'utilisateur après `FAILED`/`TIMEOUT` est une
**nouvelle intention** : nouvelle clé, nouvelle commande, nouveau
`command_id`, nouvelle échéance. On ne « relance » **jamais** une commande
existante en réutilisant son identifiant. Sinon, une commande périmée
pourrait être exécutée en retard, ou un ACK de l'ancienne tentative être
attribué à la nouvelle.

### Alternatives écartées

- **Dédup côté backend par contenu** (« même device + même type + mêmes
  params dans les N dernières secondes ») : elle confond un vrai doublon
  avec deux intentions identiques mais légitimes (allumer, éteindre,
  rallumer), et le choix de N est arbitraire. La clé du client désigne,
  elle, sans ambiguïté *la même intention*.
- **Ignorer silencieusement une commande déjà vue côté objet** : si l'ACK
  initial a été perdu, la commande finirait en `TIMEOUT` alors qu'elle a
  été exécutée.

## Décision — Affichage côté mobile

Règle : le mobile affiche **exactement ce que le backend sait**, jamais une
supposition locale. Aucun bouton ne passe à « allumée » sur un simple
appui (`mobile/src/utils/commandStatus.ts`) :

| État | Affichage |
|---|---|
| envoi HTTP | « Envoi de la demande… » (ou « Connexion perdue, nouvel essai… ») |
| `PENDING` | « Demande enregistrée… » |
| `SENT` | « En attente de confirmation de l'objet… » + réponse attendue avant `expires_at` |
| `ACKNOWLEDGED` | « ✓ Ventilation allumée/éteinte », d'après l'état **rapporté par l'objet** (`reportedState`), pas d'après la demande |
| `FAILED` | « ✗ … : échec », avec un message par raison (`broker_unavailable`, `expired_on_device`, `rejected_by_device`) |
| `TIMEOUT` | « ⚠ Pas de confirmation de l'objet — l'état réel est inconnu ». Jamais « échec », puisque l'objet a pu exécuter. Un ACK tardif éventuel est signalé (« l'objet a finalement répondu après le délai… ») |

- **Suivi** : polling de `GET /commands/:id` toutes les secondes tant que
  la commande est ouverte. Après un `TIMEOUT`, polling toutes les 3 s
  pendant 30 s pour voir un ACK tardif. Garde-fou à 90 s : au-delà, le
  suivi s'arrête et affiche « le serveur n'a toujours pas statué » (cas
  d'un worker arrêté). Le push temps réel (WebSocket) a été écarté :
  nouvelle infra pour un gain de moins d'une seconde.
- **Idempotence** : une `Idempotency-Key` par appui, **réutilisée** pour
  les 2 nouveaux essais automatiques sur erreur réseau (pas de réponse du
  serveur). Après 3 échecs réseau, le message dit qu'on **ne sait pas** si
  la demande est arrivée.
- Boutons désactivés pendant qu'une commande est ouverte et quand le
  téléphone est hors ligne. Le bloc est masqué pour un `VIEWER` (rôle lu
  dans le JWT, pour le confort d'affichage seulement : la protection reste
  le RBAC backend).

## Limites connues

- Contrat défini par l'équipe, **non vérifié contre le kit réel** :
  aucune commande n'a été publiée vers le broker partagé du kit (voir
  ADR 0004). Un écart ne toucherait que `shared/mqttTopics.ts`,
  `driving/mqtt/schemas.ts` et `infra/mqtt/MqttCommandPublisher.ts`.
- Le mobile suit l'état par polling. Si l'app est fermée pendant
  l'attente, le résultat n'est pas notifié : il reste consultable via
  l'API (pas d'historique des commandes dans l'app à ce stade).
- `expires_at` suppose des horloges objet/backend raisonnablement
  synchronisées (NTP). Un objet en avance de plus de 15 s rejetterait
  tout en `expired`.

## Conséquences

- Migration `20261009090000_command_contract` : `payload` → `params`
  (obligatoire), ajout de `expiresAt`, `failureReason`, `reportedState`.
- Migration `20261009100000_command_lifecycle` : `ACKED` → `ACKNOWLEDGED`,
  ajout de `TIMEOUT`, `timedOutAt`, `lateAckStatus`/`lateAckAt`, index
  `(status, expiresAt)` pour le balayage.
- Migration `20261009110000_command_idempotency` : `requestedBy`,
  `idempotencyKey`, contrainte unique `(requestedBy, idempotencyKey)`
  (nullables pour les commandes antérieures : NULL n'entre pas en conflit).
- Simulateur (`backend/scripts/simulate-devices.ts`) : chaque device
  s'abonne à ses commandes et applique le contrat côté objet
  (`scripts/device/commandHandler.ts`, testé dans
  `test/scripts/deviceCommandHandler.test.ts`) : vérification
  d'`expires_at`, dédup par `command_id` avec renvoi du même ACK,
  exécution puis ACK. Des options provoquent les anomalies (silencieux,
  ACK perdu/retardé, redélivrance, refus, session persistante). Il est
  lançable en conteneur (service `simulator`, profile) pour que ses logs
  JSON arrivent dans Loki.
- Journalisation de bout en bout (`eventType: command_lifecycle` /
  `command_ack`), chaque étape journalisée une seule fois, par la source qui
  la voit :

  | Étape | Process (`service`) | `msg` | Corrélation |
  |---|---|---|---|
  | demande reçue / refusée | `campify-api` | `command request received` / `rejected` | `idempotencyKey` (le `commandId` n'existe pas encore) |
  | persistance | `campify-api` | `command accepted` (PENDING) | `commandId` + `idempotencyKey` |
  | publication | `campify-api` | `command published` / `not published` / `publish unconfirmed` | `commandId` |
  | réception, exécution, ACK | `device-simulator` | `command received`, `command executed`…, `ack sent` / `ack dropped` | `commandId` |
  | réception de l'ACK | `campify-ingester` | `command ack received` | `commandId` |
  | mise à jour de l'état | `campify-ingester` / `campify-worker` | `command acknowledged by device` (`latencyMs`), `late ack…`, `duplicate ack…`, `command timed out` | `commandId` |

  Outils : dashboard Grafana « Campify — Commandes (J4) » et
  `npm run trace:command -- <commandId>`, qui coche les étapes attendues et
  désigne la première manquante.

Voir aussi : [[0004-contrat-mqtt-placeholder]], [[0008-identite-devices-authentification-mqtt]],
[[0010-session-mqtt-persistante]], [[0011-worker-consolidation-polling]].
