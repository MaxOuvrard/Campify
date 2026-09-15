# ADR 0003 — Patterns explicitement écartés

## Statut

Acceptée.

## Décision

Pour rester proportionné au périmètre du projet (4-5 entités, un seul
service, volume modeste), les patterns suivants sont explicitement
écartés :

| Pattern | Raison de l'exclusion |
|---|---|
| CQRS | Aucune asymétrie lecture/écriture qui le justifie sur ce volume. |
| Event sourcing | Le gain (replay, audit) est disproportionné par rapport au besoin réel (historique borné + dernier état). |
| DDD strict / bounded contexts | 4 entités, un seul `domain/` suffit — voir [[0001-architecture-hexagonale]]. |
| Microservices | Un service unique couvre tout le périmètre fonctionnel. |

## Conséquences

Si le périmètre grossit significativement (multi-tenant à grande échelle,
besoin d'audit réglementaire, équipes multiples travaillant sur des
sous-domaines indépendants), cette décision doit être révisée — mais ce
n'est pas le cas aujourd'hui.
