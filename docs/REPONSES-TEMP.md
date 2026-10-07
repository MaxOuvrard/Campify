# Notre base « brute » est-elle vraiment brute ?

**Réponse courte : non.** Elle contient des mesures déjà nettoyées, pas les
messages tels qu'ils sont arrivés. Le nom « brute » est trompeur.

## Ce qui se passe quand un message MQTT arrive

```
message MQTT → on lit le JSON → on vérifie la forme (Zod) → on découpe par mesure → on écrit en base
```

Chaque étape peut jeter le message ou le transformer **avant** qu'il arrive
dans la base. Le code est dans `backend/src/driving/mqtt/handlers.ts`.

## Réponse à chaque question

**Que devient un JSON invalide ?**
On écrit une ligne dans les logs (« JSON invalide »), puis on l'abandonne.
Le contenu du message n'est enregistré nulle part. Il est perdu.

**Que devient un payload refusé par Zod ?**
Pareil : une ligne dans les logs avec la raison du refus, et le message est
abandonné. Le contenu n'est pas gardé.

**Le message MQTT original est-il conservé quelque part ?**
Non. Ni le texte du message, ni le topic, ni les infos MQTT (QoS, retained).

**Un message avec plusieurs mesures reste-t-il un seul événement ?**
Non. Un message « température + CO₂ » devient **deux lignes** séparées en
base. Elles ne sont reliées que par un identifiant commun (`messageId`).
Si une ligne s'écrit et pas l'autre, on garde une moitié de message.

**Si notre validation a un bug, peut-on rejouer les messages d'origine demain ?**
Non. Si Zod rejette à tort des messages valides, ils sont perdus
définitivement. Pour ceux qui ont été acceptés, on ne garde qu'une version
simplifiée (on a perdu par exemple `schema_version`, `room_id`).

**Différence entre événement brut, mesure normalisée et donnée vérifiée ?**

| Niveau | C'est quoi | Chez nous |
|---|---|---|
| Événement brut | Le message MQTT exactement comme reçu | **N'existe pas** |
| Mesure normalisée | Une mesure propre : valeur, unité, type, date | `RawMeasurement` (TimescaleDB) |
| Donnée vérifiée | Une mesure acceptée : ni doublon, ni en retard, plausible | `Measurement` (PostgreSQL) |

Notre « base brute » est en fait la deuxième ligne : des **mesures normalisées
non filtrées**.

## Question centrale : à quel moment un événement est-il ingéré sans perte ?

**Chez nous : jamais vraiment.**

- Pour une mesure valide, on garde l'essentiel (valeur, unité, type, date,
  capteur). On perd l'enveloppe du message.
- Pour un message invalide ou refusé, on ne garde rien.
- Il y a en plus un second problème : la librairie MQTT dit « bien reçu » au
  broker **avant** qu'on ait écrit en base. Si le programme plante juste
  après, le message est perdu et le broker ne le sait pas. Donc le QoS 1 et la
  session persistante garantissent que le message arrive jusqu'à notre
  programme, pas qu'il est enregistré.

## Ce qu'il faudrait pour être vraiment « sans perte »

1. Une table `RawEvent` : **un message MQTT = une ligne**, avec le texte
   original, le topic et la date de réception. On l'écrit en premier, même si
   le JSON est invalide.
2. La validation (Zod) et le découpage en mesures se font **après**, dans le
   worker. Un bug de validation devient alors rattrapable : on corrige et on
   rejoue.
3. On dit « bien reçu » au broker **seulement après** avoir écrit en base.

## Ce qu'on peut dire à l'oral

> « Aujourd'hui notre base brute est en réalité une base de mesures
> normalisées. On a identifié que ça ne permet pas de rejouer les messages
> d'origine. La correction serait de stocker le message MQTT tel quel, avant
> toute interprétation, et de déplacer la validation dans le worker. »

---

# 2. Ingestion et consolidation sont-elles découplées ?

**Réponse courte : oui depuis ce matin, et la consolidation rattrape seule
son retard après une panne. Mais il y a un défaut grave : une seule ligne
qui échoue bloque toute la file.**

Le schéma « tout dans un même appel » était vrai avant (ADR 0011). Aujourd'hui
il y a trois process séparés : l'ingester écrit en base brute, le worker
consolide, l'API lit. La fonction `ingest()` existe encore mais ne sert plus
qu'aux tests.

## Si PostgreSQL est indisponible pendant 10 minutes

- **L'ingestion continue.** L'ingester n'écrit que dans TimescaleDB. Les
  mesures s'accumulent dans la base brute (environ 3 lignes par seconde avec
  nos 3 capteurs, soit ~1800 lignes en 10 minutes).
- **Le worker échoue puis réessaie.** Toutes les 3 secondes il tente la
  première ligne, échoue, écrit « consolidation polling tick failed » dans les
  logs, ne marque rien comme traité, et recommence 3 secondes plus tard.
  Pas de pause qui s'allonge : environ 200 lignes d'erreur dans les logs en
  10 minutes.
- **L'API est en erreur** pendant la panne (elle lit PostgreSQL). C'est hors
  du pipeline d'ingestion.

**Testé** (avec des fakes en mémoire) : pendant la panne, 0 mesure vérifiée
et 3 en attente ; au retour de PostgreSQL, 3 vérifiées et 0 en attente,
sans que personne n'intervienne.

## Quel composant retrouve les événements non consolidés ?

Le **worker**, tout seul. À chaque passage il demande à la base brute « donne-moi
les lignes dont `consolidatedAt` est vide, les plus anciennes d'abord ».
Aucune action manuelle.

## Où est stocké l'état pending / processing / processed / error ?

Dans **une seule colonne** : `consolidatedAt` (vide = en attente, remplie =
traitée). Il manque donc :

- un état « en cours » (`processing`),
- un état « en erreur » (`error`) et un compteur d'essais,
- le **résultat** : on ne sait pas, depuis la base, si une ligne traitée a été
  acceptée ou rejetée, ni pourquoi. Ça n'existe que dans les logs.
- un verrou : deux workers pourraient prendre la même ligne (déjà noté dans
  l'ADR 0011).

## Comment mesurez-vous le lag ?

**On ne le mesure pas en continu.** Pas de métrique, pas de dashboard, pas
d'alerte, et le worker n'écrit rien quand il n'y a rien à faire. On peut le
calculer à la main en SQL (nombre de lignes en attente, âge de la plus
ancienne), ce que j'ai fait plusieurs fois en vérifiant. Après coup,
`consolidatedAt - receivedAt` donne le retard de chaque ligne.

## Question centrale : la consolidation peut-elle tomber sans arrêter l'ingestion, puis rattraper son retard ?

**Oui pour une panne complète** (testé ci-dessus). **Non dans un cas
courant : la ligne empoisonnée.**

Si une ligne échoue à chaque fois (par exemple un capteur absent de la table
des devices : la base vérifiée refuse l'écriture), le worker retombe dessus
à chaque passage et **toutes les lignes suivantes attendent derrière**.

**Testé** : 1 ligne en échec en tête + 2 lignes valides derrière → 0 mesure
vérifiée, 3 en attente, erreurs en boucle. Avant ce matin, l'ancien code
journalisait l'erreur et passait au message suivant : c'est une **régression
introduite par notre refactor**. Un seul nouveau capteur non enregistré
(ex. `sensor-004`) suffirait à geler toute la consolidation.

## Ce qui manque dans le pipeline

1. **Isoler chaque ligne** : une erreur sur une ligne ne doit pas stopper les
   suivantes (correction petite, c'est la plus urgente).
2. **Un vrai état par ligne** : `pending` / `processed` / `error`, un nombre
   d'essais, la dernière erreur, et le résultat (accepté ou rejeté + motif).
   Après N échecs la ligne passe en `error` et sort de la file (quarantaine
   visible).
3. **Mesurer le lag** : nombre de lignes en attente et âge de la plus
   ancienne, loggués à chaque passage, affichés dans Grafana, avec une alerte.
4. **Pause qui s'allonge** après des échecs répétés, au lieu de réessayer
   toutes les 3 secondes.

---

# 3. Peut-on faire évoluer API, ingestion et consolidation séparément ?

**Réponse courte : l'API et l'ingestion sont déjà séparées (ADR 0012), donc la
question de départ n'est plus vraie. Ingestion ×N : oui, testé. API ×N :
presque. Consolidation ×N : non, et c'est dangereux aujourd'hui.**

| Brique | Peut-on la multiplier ? | Preuve |
|---|---|---|
| API ×N | Presque (il manque un répartiteur de charge) | lecture du code |
| Ingestion ×N | **Oui** | testé : 3 instances, 6 messages → 6 lignes |
| Consolidation ×N | **Non, ça corrompt les données** | testé : 2 workers, 10 lignes → 20 en base vérifiée |

## Si on lance 4 instances du backend, combien reçoivent chaque message MQTT ?

**Aucune.** Depuis l'ADR 0012, le backend (API) ne s'abonne plus à MQTT, il
sert seulement du HTTP et publie les commandes. Avant ce matin, c'était
pire : un `clientId` fixe, donc les instances se seraient déconnectées les
unes les autres en boucle.

## Les abonnements permettent-ils de répartir les messages ?

**Oui, pour l'ingester**, grâce à la souscription partagée (`$share/...`) :
chaque message n'est reçu que par une seule instance du groupe. Testé en
local avec 3 instances.

Les limites à connaître :

- Le broker du VPS n'a **pas été vérifié** pour `$share`. Quand on se
  connecte au VPS, on désactive volontairement la souscription partagée :
  avec plusieurs ingesters, chacun recevrait **tous** les messages et la base
  brute serait remplie en N exemplaires.
- Pas testé : que devient la part d'une instance qui s'arrête pendant que
  les autres tournent.
- Plusieurs ingesters peuvent écrire un message récent avant un plus ancien,
  qui sera alors refusé comme « en retard » par la consolidation.

## Veut-on scaler les trois avec le même facteur ?

**Non**, ils ne sont pas limités par la même chose :

| Brique | Ce qui la limite |
|---|---|
| API | nombre de requêtes des apps, connexions PostgreSQL |
| Ingestion | débit du broker, insertions en base brute (travail léger) |
| Consolidation | 3 requêtes SQL par ligne, faites une par une |

Un détail important : le worker traite au maximum **200 lignes toutes les
3 secondes (environ 66 lignes/s)**, même quand il y a du retard à rattraper,
parce qu'il attend 3 secondes après chaque lot. Avec nos capteurs on est à
environ 3 lignes/s, donc ça passe, mais c'est un plafond fixé par la
configuration, pas par la machine.

## Augmenter seulement les workers de consolidation

**Aujourd'hui, c'est impossible sans casser les données.** Les workers ne
réservent pas leurs lignes : deux workers prennent les mêmes 200 lignes les
plus anciennes et écrivent chacun le résultat. Testé : **10 lignes brutes →
20 lignes vérifiées, dont 10 doublons**.

La solution que je recommande : **chaque worker ne s'occupe que d'une partie
des capteurs** (par exemple le capteur dont le numéro, haché, modulo N donne
l'indice du worker). Un même capteur est toujours traité par le même worker,
donc l'ordre et la déduplication restent corrects, sans verrou et sans
nouvelle technologie. Il faut deux variables (`WORKER_COUNT`, `WORKER_INDEX`)
et un filtre dans la requête de lecture de la base brute.

Alternative plus dynamique : réserver les lignes avec `SELECT ... FOR UPDATE
SKIP LOCKED`, mais il faut en plus un verrou par capteur pour garder l'ordre.
C'est plus complexe.

## Augmenter seulement l'ingestion

**Déjà possible** : `docker compose up -d --scale ingester=N`, sans toucher à
l'API ni au worker. Seule condition : le broker doit supporter `$share`
(Mosquitto local : oui, VPS : à vérifier).

## Architecture proposée

```
Capteurs → Broker MQTT ──($share)──► ingester ×N ──► base brute (TimescaleDB)
                                                           │
                          chaque worker lit SES capteurs   ▼
                                                    worker 0 … N-1 ──► base vérifiée (PostgreSQL)
                                                                              ▲
Apps mobiles ──► répartiteur de charge ──► API ×N ───────────────────────────┘
```

| Pour scaler… | Ce qu'il faut |
|---|---|
| API ×N | un répartiteur de charge devant (nginx / Traefik) ; retirer le port 3000 fixe de `docker-compose.yml` (conflit de port dès la 2e instance) ; garder la taille du pool Prisma × N sous la limite de connexions PostgreSQL. Le JWT ne demande aucun état partagé. |
| Ingestion ×N | rien à ajouter, vérifier `$share` sur le broker utilisé |
| Consolidation ×N | partition par capteur **(à coder)** + enchaîner les lots sans pause + isoler chaque ligne en erreur (point 2) + mesurer le lag de chaque worker |

## Ordre pour y arriver

1. Isoler chaque ligne en erreur (sinon un seul capteur inconnu gèle tout).
2. Enchaîner les lots sans attendre 3 s quand il reste du retard.
3. Partitionner les workers par capteur.
4. Seulement ensuite, lancer plusieurs workers.

---

# 7. Pourquoi TimescaleDB ?

**Réponse courte : aujourd'hui on utilise un PostgreSQL dans une image
TimescaleDB, sans exploiter aucune fonctionnalité propre à TimescaleDB.**
Le choix n'est pas faux, mais il n'est pas justifié par ce qu'on utilise.

## Ce qu'on utilise réellement (vérifié dans la base)

| Question | Réponse |
|---|---|
| Fonctionnalités TimescaleDB utilisées | **Aucune.** |
| `RawMeasurement` est-elle un hypertable ? | **Non.** `timescaledb_information.hypertables` renvoie 0 ligne. |
| `time_bucket`, continuous aggregates, compression, rétention ? | **Aucun.** Zéro occurrence dans le code et dans les migrations. |
| L'extension est-elle installée ? | Oui, mais uniquement parce que l'image Docker la crée toute seule au premier démarrage (`000_install_timescaledb.sh`). Aucune de nos migrations ne la demande. |

La seule chose dont on profite « sans le savoir » : l'image règle
automatiquement la mémoire de PostgreSQL au premier démarrage
(`timescaledb_tune`). C'est un confort, pas une raison de choisir.

## Si je remplace le conteneur par PostgreSQL 16 standard ?

**Testé** dans un conteneur jetable : les 2 migrations s'appliquent, le test
de contrat du repository `RawMeasurement` passe. **Rien ne cesse de
fonctionner.** La seule différence : l'extension `timescaledb` n'est plus là,
et personne ne l'utilise.

## Quel problème concret justifie TimescaleDB aujourd'hui ?

| Raison possible | Dans notre cas |
|---|---|
| Volume | 93 000 lignes en 3 semaines : très petit |
| Ingestion | environ 3 lignes/s : très loin des limites d'un PostgreSQL standard |
| Séries temporelles, agrégation | non utilisées (aucun `time_bucket`) |
| Rétention | aucune : on ne supprime jamais rien |
| Compression | aucune |

**Aucun problème concret ne la justifie à ce jour.** L'ADR 0005 le dit
d'ailleurs presque : il justifie « une base distincte », jamais un
hypertable.

## Un problème qu'on a trouvé en vérifiant

La table fait **427 Mo pour 93 000 lignes** (135 Mo de données + 291 Mo
d'index, avec 16 000 lignes mortes). C'est environ 10 fois trop.

Cause : la base brute devait être une zone où on **ajoute** seulement, mais
chaque ligne est **modifiée** après coup (`consolidatedAt`, voir l'ADR 0011),
et cette colonne est indexée. Chaque modification recopie la ligne et ses
entrées d'index. Ce mode de fonctionnement s'accorde mal avec la compression
de TimescaleDB (modifier des données compressées coûte cher).

## Scénario : 500 millions de mesures sur 12 mois

Ça fait environ **16 lignes/s** en moyenne : seulement 5 fois plus qu'aujourd'hui.
Le défi n'est donc pas l'ingestion, c'est **le stockage, la rétention et les
agrégats**. C'est là que TimescaleDB devient utile :

| Besoin | Ce que j'utiliserais |
|---|---|
| Découper les données par période | un **hypertable** sur la date de réception (chunks d'1 jour ou d'1 semaine) |
| Limiter le coût de stockage | la **compression** des chunks de plus de 7 jours (regroupés par capteur et type), souvent d'un facteur 10 environ sur ce genre de données, à mesurer ; supprimer les index inutiles |
| Gérer la rétention | une **politique de rétention** (par exemple garder 30 à 90 jours de brut) : TimescaleDB supprime un chunk entier d'un coup, sans `DELETE` ni nettoyage lent |
| Calculer des agrégats | des **continuous aggregates** avec `time_bucket('1 hour', …)` (moyenne, min, max par capteur et par heure), maintenus automatiquement. On garde ces agrégats 12 mois, on jette le brut après 90 jours. |

Sans TimescaleDB, on peut aussi y arriver (partitionnement manuel,
`pg_partman`, `GROUP BY date_trunc(...)`), mais il faut tout écrire et
surveiller soi-même.

Pour que ça marche proprement il faudrait aussi **arrêter de modifier les
lignes brutes** : garder l'état de consolidation ailleurs (un curseur ou une
petite table de suivi), pour que la table brute reste en ajout seul.

## Question centrale

**Utilisez-vous TimescaleDB, ou un PostgreSQL compatible TimescaleDB ?**
→ **Un PostgreSQL compatible TimescaleDB**, sans exploiter ses fonctions.

Deux choix explicites possibles :

- **A. Assumer PostgreSQL standard** (image `postgres:16`) : plus simple, zéro
  perte à notre échelle (testé). On note dans l'ADR que TimescaleDB a été
  envisagé et que le volume actuel ne le justifie pas.
- **B. Exploiter vraiment TimescaleDB** : hypertable + rétention (le plus
  défendable pour une zone d'atterrissage temporaire) + compression, et sortir
  l'état `consolidatedAt` de la table brute.

## Ce qu'on peut dire à l'oral

> « Aujourd'hui notre base brute tourne sur une image TimescaleDB mais sans
> hypertable ni aucune fonction spécifique : c'est en pratique un
> PostgreSQL. On l'a vérifié : avec PostgreSQL 16 standard, tout fonctionne
> pareil. À notre volume (3 lignes/s) ça ne change rien. À 500 millions de
> lignes, on activerait l'hypertable, la compression, une rétention de
> quelques mois et des agrégats par heure, et on retirerait la mise à jour
> de `consolidatedAt` de la table brute. »
