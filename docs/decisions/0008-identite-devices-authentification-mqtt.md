# ADR 0008 — Identité des devices et authentification MQTT

## Statut

Acceptée (broker local uniquement — voir limites ci-dessous).

## Contexte

Scénario J3 "Usurpation d'un device" : rien n'empêchait aujourd'hui un
client quelconque de publier sur le topic de télémétrie d'un autre device.
Constat sur le broker local (`backend/mosquitto.conf` avant ce changement,
`allow_anonymous true`, aucune ACL) :

- N'importe quel client connecté au broker peut publier sur
  `campus/v1/devices/sensor-001/telemetry`, qu'il soit ou non le vrai
  `sensor-001`.
- Le backend ne peut pas s'en apercevoir : `driving/mqtt/handlers.ts`
  résout le `deviceId` **depuis le topic**, pas depuis le payload
  (`device_id`/`room_id` du payload sont délibérément ignorés, voir ADR
  0004) — un choix qui a du sens quand le topic lui-même fait foi, mais qui
  suppose que seul le vrai device puisse publier sur son propre topic. Ce
  n'était pas le cas.
- Aucune validation de payload (schéma Zod, plausibilité) ne peut compenser
  ceci : un message usurpé peut être structurellement et physiquement
  parfaitement valide.

Autrement dit, la confiance dans un `deviceId` ne peut se construire qu'au
niveau de la connexion MQTT (qui a le droit de publier où), jamais au
niveau applicatif après coup — le domaine consomme un flux déjà résolu, il
n'a pas les moyens de vérifier une identité que le broker a laissée passer.

**Limite assumée** : le broker de démonstration du kit (VPS partagé, voir
ADR 0004) n'est pas sous notre contrôle. Cette
décision durcit le broker **local** (`backend/docker-compose.yml`) ; elle
ne change rien à la sécurité du broker du kit, dont on ignore même si les
devices simulés s'authentifient individuellement ou via un identifiant
partagé.

## Décision

- `mosquitto.conf` : `allow_anonymous false` + `password_file` +
  `acl_file`. Toute connexion sans identifiants est refusée dès le
  `CONNECT`.
- `mosquitto.acl` (nouveau) : un identifiant MQTT = un device (son nom
  d'utilisateur égale son `deviceId`, ex. `sensor-001`). Règle `pattern
  write campus/v1/devices/%u/telemetry` : un device ne peut publier que sur
  sa propre télémétrie, jamais sur celle d'un autre. Le `backend` a son
  propre identifiant, avec lecture sur toute la télémétrie/les acks et
  écriture sur les commandes — ce n'est pas un device, il n'a pas besoin
  d'écrire de télémétrie.
- Identifiants générés localement (`mosquitto_passwd`, procédure dans
  `backend/README.md`), jamais commités (`mosquitto.passwd` dans
  `.gitignore`) — cohérent avec la politique secrets de J3.

## Alternatives envisagées

- **Ne rien faire, documenter le risque** : rejeté — le sujet demande
  explicitement une mitigation quand elle est possible, et celle-ci est peu
  coûteuse sur l'infra qu'on contrôle.
- **Vérifier `device_id` du payload contre le topic** : rejeté comme
  mitigation (pas comme signal) — un attaquant qui usurpe un topic peut
  tout aussi bien faire correspondre le payload. Ça n'aurait ajouté qu'un
  garde-fou contre les erreurs de configuration accidentelles, pas contre
  une usurpation volontaire ; on ne voulait pas présenter ça comme une
  protection qu'il n'est pas.
- **mTLS (certificat client par device)** : plus robuste (identité liée à
  une clé privée, pas à un mot de passe partagé au transport), mais suppose
  un mécanisme de provisioning de certificats par device que ni le kit ni
  le prototype n'ont — hors périmètre du temps disponible sur J3. Piste à
  reprendre si le projet doit dépasser le stade prototype.
- **Signature applicative du payload (HMAC par device)** : rejeté pour la
  même raison (pas de mécanisme de distribution de clé), et redondant avec
  l'authentification transport une fois celle-ci en place.

## Conséquences

- `docker compose up` exige désormais une étape supplémentaire
  (génération de `mosquitto.passwd`) avant de démarrer Mosquitto —
  documentée dans `backend/README.md`, décrite comme prérequis explicite
  plutôt que comme valeur par défaut silencieuse.
- `MQTT_URL` en local doit désormais porter des identifiants
  (`mqtt://backend:<mot-de-passe>@localhost:1883`) — `.env.example` mis à
  jour.
- Le broker du kit (VPS) reste un risque résiduel accepté, hors de notre
  contrôle — à signaler explicitement dans `docs/J3.md` plutôt que de
  laisser croire que le sujet est clos.
- Preuve à produire une fois Docker disponible pour rejouer le scénario :
  tentative de connexion anonyme (refusée), tentative de `sensor-001` de
  publier sur le topic de `sensor-002` (refusée par l'ACL), publication sur
  son propre topic (acceptée) — protocole détaillé dans le tableau de
  recette de `docs/J3.md`.
