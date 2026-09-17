# ADR 0007 — Association d'un équipement par QR code et règle de réaffectation

## Statut

Acceptée.

## Contexte

Jour 3, mission 1 : un utilisateur scanne le QR code collé sur un
équipement du kit pour l'associer à une salle dans Campify. Le kit fournit
le format exact des QR de démonstration et ses cas limites :

- `campus-device:v1:sensor-001` (et `-002`, `-003`) : format valide,
  équipement existant.
- `campus-device:v1:sensor-999` : format valide, équipement inconnu.
- `ceci-n-est-pas-un-objet` : format invalide.

Le QR ne contient que l'identifiant public de l'équipement — il ne confère
aucun droit. Toute vérification (format, existence, droits, réaffectation)
est donc à la charge du backend, jamais présumée côté mobile.

## Décision

- **Format** : `parseDeviceIdentifier` (`backend/src/domain/services/deviceAssociation.ts`)
  extrait l'id depuis `campus-device:v1:{deviceId}`. Ce parsing vit dans le
  domaine (pas dans `shared/`, contrairement à `mqttTopics.ts`) : contrairement
  au contrat MQTT qui est un protocole de transport, décider ce qui
  constitue un identifiant d'équipement valide est un concept métier
  (résoudre un objet à partir de son code public), pas un détail de wire
  format.
- **Un seul point d'entrée domaine**, `DeviceAssociationService.associate(identifier, roomId)`,
  appelé uniquement depuis `driving/api/routes/associations.ts`
  (`POST /rooms/:id/devices/associate`) :
  1. format invalide → `ValidationError` (400) ;
  2. équipement introuvable → `NotFoundError` (404) ;
  3. salle cible introuvable → `NotFoundError` (404) ;
  4. sinon, réaffectation.
- **Droits** : route protégée par `requireRole('ADMIN', 'OPERATOR')`, comme
  `POST /rooms` et `POST /devices/:id/commands` — associer un équipement
  modifie l'état métier au même titre que créer une salle ou piloter un
  device, donc soumis à la même politique. Un VIEWER scannant un QR reçoit
  un 403 : le scan ne contourne jamais le contrôle d'accès.
- **Règle de réaffectation : libre et sans historique.** Un équipement peut
  être déplacé d'une salle à une autre à tout moment ; la dernière
  association gagne (`DeviceRepository.updateRoom`, simple update de
  `roomId`). Aucune contrainte de verrouillage ni de conservation de
  l'ancienne affectation : aucun besoin métier identifié à ce stade pour
  justifier plus de complexité (cf. [[0003-exclusions-cqrs-event-sourcing-ddd-microservices]]
  sur le principe général de ne pas anticiper un besoin non exprimé). Les
  salles de `devices.json` (simulateur) ne servent que de contexte initial ;
  l'affectation qui fait foi est celle stockée par Campify et peut diverger
  dès le premier scan.

## Conséquences

- Le mobile (`ScanDeviceScreen.tsx`) ne fait aucune validation métier : il
  scanne (ou saisit manuellement en repli), transmet le texte brut à l'API,
  et affiche le message renvoyé par le backend selon le code HTTP (400/403/404).
  Un parcours de repli existe quand la caméra est refusée : bouton vers les
  réglages système si la permission est définitivement refusée, et champ de
  saisie manuelle du code dans tous les cas.
- Si une vraie règle de réaffectation (verrou, historique, validation
  géographique...) émerge plus tard, elle s'ajoute dans
  `DeviceAssociationService.associate` sans toucher aux routes ni au mobile.
- Preuves : `backend/test/domain/services/deviceAssociation.test.ts`,
  `backend/test/driving/api/server.test.ts` (association RBAC + 400/404),
  `backend/test/infra/db/prismaDeviceRepository.test.ts` (`updateRoom`),
  `mobile/src/screens/__tests__/ScanDeviceScreen.test.tsx`.
