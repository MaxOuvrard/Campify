-- La base vérifiée passe sur TimescaleDB (ADR 0013) : Measurement devient une
-- hypertable partitionnée par `timestamp`. Nécessite l'image
-- timescale/timescaledb (voir docker-compose.yml) — sur un PostgreSQL
-- standard, cette migration échoue à la création de l'extension.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- TimescaleDB exige que toute clé primaire contienne la colonne de partition.
ALTER TABLE "Measurement" DROP CONSTRAINT "Measurement_pkey";
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id", "timestamp");

-- `migrate_data` : convertit les mesures déjà présentes. Pas d'index par
-- défaut sur `timestamp` : "Measurement_deviceId_timestamp_idx" couvre les
-- requêtes, et un index hors schéma Prisma créerait une dérive à la
-- prochaine `prisma migrate dev`.
SELECT create_hypertable(
  '"Measurement"',
  'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  create_default_indexes => FALSE,
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Compression des chunks de plus de 7 jours (sans perte, lecture inchangée).
-- Segmentation par device+type : c'est l'axe de toutes les requêtes.
ALTER TABLE "Measurement" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = '"deviceId", "type"',
  timescaledb.compress_orderby = '"timestamp" DESC'
);
SELECT add_compression_policy('"Measurement"', INTERVAL '7 days', if_not_exists => TRUE);
