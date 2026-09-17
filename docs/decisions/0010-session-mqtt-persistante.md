# ADR 0010 — Session MQTT persistante pour le backend

## Statut

Acceptée.

## Contexte

Scénario J3 "Backend indisponible" : arrêter le backend pendant que les
capteurs continuent de publier, le redémarrer, déterminer ce qui a été
perdu, rejoué ou récupéré.

**Hypothèse de départ** : à QoS 1, le broker devrait mettre en attente les
messages publiés pendant que le backend est déconnecté, et les lui
redistribuer à la reconnexion.

**Injection** : backend coupé (`docker compose stop backend`) pendant que
3 devices simulés publient en continu, puis redémarré.

**Observation (avant correction)** : `mqtt.connect(config.MQTT_URL)`
(sans `clientId` ni `clean: false`) — mqtt.js génère un identifiant
aléatoire à chaque connexion et utilise une session "clean" par défaut.
Résultat : **toutes les mesures publiées pendant la coupure ont été
perdues**, y compris à QoS 1 — vérifié en base (`messageId` de
`sensor-001` passant de `...-20` à `...-38`, aucune trace de `...-21` à
`...-37`).

**Explication** : un broker MQTT ne met en attente les messages pour un
abonné déconnecté que si celui-ci a une **session persistante**
(`clean: false` + `clientId` stable entre connexions) — sans ça, le
broker ne se souvient d'aucun abonnement une fois le client parti, et n'a
donc rien à mettre en file pour lui, quel que soit le QoS de publication.
Le QoS seul ne suffit pas : il gouverne la fiabilité de la livraison
*pendant* une connexion active, pas la mémorisation d'un abonné absent.

## Décision

`composition.ts` : `mqtt.connect(config.MQTT_URL, { clientId:
'campify-backend', clean: false })`. Combiné à `MQTT_QOS=1` (déjà le
défaut, voir `docker/architecture.md`), le broker met désormais en
attente toute mesure publiée pendant que le backend est déconnecté, et la
redistribue à la reconnexion (`sessionResumed: true` dans les logs de
connexion — voir `driving/mqtt/client.ts`).

**Vérification (après correction), même scénario rejoué** : backend
coupé, 3 devices publient (QoS 1) pendant ~15s, backend redémarré → log
`"sessionResumed":true`, puis rattrapage complet des mesures en attente
(vérifié en base : tous les `messageId` `...-1` à `...-21` présents pour
`sensor-002`, aucun trou). Quelques mesures arrivées en rafale au
rattrapage sont rejetées `reason: "late"` par la dédup — attendu et
correct : plusieurs devices redistribuent leur backlog en concurrence, un
message plus ancien d'un device peut être traité juste après un plus
récent du même device sans que ça ne remette jamais en cause l'état
courant.

## Alternatives envisagées

- **Ne rien changer, documenter la perte comme limite acceptée** : rejeté
  — la correction est peu coûteuse (une ligne) et élimine une vraie perte
  de données sur l'incident le plus probable (redéploiement du backend).
- **Répliquer plusieurs instances backend pour la haute disponibilité** :
  hors de portée pour un prototype ; une session persistante couvre déjà
  le cas réel visé (redémarrage/déploiement), pas une bascule sans
  interruption.

## Conséquences

- Un seul backend actif à la fois : une deuxième instance se connectant
  avec le même `clientId` ferait déconnecter la première (comportement
  standard MQTT sur collision de `clientId`) — acceptable pour une
  architecture mono-instance, à revisiter si le projet doit un jour
  scaler horizontalement.
- La file d'attente du broker n'est pas illimitée (limites par défaut de
  Mosquitto, non ajustées) : une coupure backend très longue avec un
  volume de publication élevé perdrait quand même les messages au-delà de
  cette limite — non testé, limite connue.
- Persiste uniquement pour le broker **local** que nous contrôlons ; le
  comportement du broker de démonstration du kit (VPS partagé) sur ce
  point n'a pas été vérifié.
