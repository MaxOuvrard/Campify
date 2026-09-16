# ADR 0006 — Cache mobile "dernière valeur connue" et affichage de la fraîcheur

## Statut

Acceptée.

## Contexte

Le téléphone perd le réseau, passe en arrière-plan, ou revient d'une mise
en veille — dans tous ces cas l'utilisateur ouvre l'écran d'une salle et
doit voir quelque chose de cohérent : ni écran vide, ni valeur qui se fait
silencieusement remplacer par une donnée plus ancienne, ni doute sur l'âge
de ce qui est affiché.

## Décision

- **Cache "dernière valeur connue" par clé**, dans `mobile/src/storage/cache.ts`
  (`readCache`/`writeCache`, AsyncStorage, préfixe `campify:cache:`) : à
  chaque fetch réussi (`GET /rooms/:id/measurements/latest`), la réponse et
  sa date d'écriture (`cachedAt`) sont sauvegardées sous la clé
  `room:{id}:measurements`. Une clé = une seule entrée, la dernière écriture
  écrase la précédente (pas d'historique côté mobile — l'historique borné
  vit côté API, voir [[0005-dedup-ordre-et-separation-base-brute-verifiee]]).
- **Best-effort explicite** : toute erreur de lecture/écriture AsyncStorage
  est avalée (`try/catch` retourne `null` ou ne fait rien). Le cache est un
  confort d'affichage, jamais un chemin qui peut faire planter ou bloquer
  l'écran.
- **`RoomDetailScreen`** affiche toujours une date ("Données du …") à côté
  des mesures : celle du dernier fetch réussi, ou à défaut celle du cache
  tant qu'aucun fetch n'a encore abouti — jamais de donnée affichée sans
  date associée.
- **Un fetch qui échoue ne remplace jamais ce qui est déjà affiché**
  (`hasData.current`) : ni par un écran d'erreur, ni par une valeur plus
  ancienne. L'écran d'erreur n'apparaît que si aucune donnée (fraîche ou en
  cache) n'a encore pu être affichée.
- **Trois déclencheurs de re-fetch automatique** : montage de l'écran,
  retour au premier plan (`useAppForeground`, sur `AppState` background/
  inactive → active), et retour réseau (`useNetworkStatus`, sur `NetInfo`
  faux → vrai). Un fetch réussi remplace la donnée affichée (fraîche ou en
  cache) par la nouvelle, quelle qu'elle soit.
- **`fresh` est un champ métier renvoyé par l'API** (voir
  [[0005-dedup-ordre-et-separation-base-brute-verifiee]] et
  `domain/services/freshness.ts`), pas recalculé côté mobile : une mesure
  non fraîche reste affichée avec un badge "Capteur silencieux", elle ne
  disparaît pas. C'est distinct de `isConnected` (connectivité du
  téléphone, `useNetworkStatus`), affiché séparément via une bannière
  "Téléphone hors ligne".

## Conséquences

- Pas de dépendance de synchronisation lourde (pas de queue offline, pas de
  merge de données) : le mobile est un client read-only pour les mesures,
  donc "dernière valeur connue + date" suffit.
- Le cache ne survit pas à une désinstallation ni ne se synchronise entre
  appareils (AsyncStorage est local) — accepté, hors périmètre.
- Preuves : `mobile/src/storage/__tests__/cache.test.ts`,
  `mobile/src/hooks/__tests__/useNetworkStatus.test.ts`,
  `mobile/src/hooks/__tests__/useAppForeground.test.ts`,
  `mobile/src/screens/__tests__/RoomDetailScreen.test.tsx`.
