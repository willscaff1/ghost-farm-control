-- Railway/PostgreSQL disk cleanup for screenshot-heavy tables.
-- Run the diagnostic section first in Railway's PostgreSQL query console.
-- The object from the error can be checked with the OID query below.

-- 1) Identify the relation that appears in:
--    could not extend file "base/16384/26120"
SELECT
  c.oid,
  n.nspname AS schema_name,
  c.relname AS object_name,
  c.relkind,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = 26120;

-- 2) Show the biggest application tables.
SELECT
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname))) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(format('%I.%I', schemaname, relname)) DESC
LIMIT 20;

-- 3) Show screenshot storage volume.
SELECT
  'deliveries.screenshot_url' AS storage_area,
  COUNT(*) FILTER (WHERE screenshot_url IS NOT NULL) AS rows_with_images,
  pg_size_pretty(COALESCE(SUM(octet_length(screenshot_url)), 0)) AS approx_payload
FROM deliveries
UNION ALL
SELECT
  'delivery_screenshots',
  COUNT(*),
  pg_size_pretty(COALESCE(SUM(octet_length(screenshot_url)), 0))
FROM delivery_screenshots
UNION ALL
SELECT
  'extra_farm_screenshots',
  COUNT(*),
  pg_size_pretty(COALESCE(SUM(octet_length(screenshot_url)), 0))
FROM extra_farm_screenshots;

-- 4) Conservative cleanup: remove duplicate legacy inline image copies.
-- The app now stores delivery screenshots only in delivery_screenshots.
UPDATE deliveries
SET screenshot_url = NULL
WHERE screenshot_url IS NOT NULL;

-- 5) Conservative cleanup: keep recent prints, remove old screenshot payloads.
-- Change "14 days" if you need a longer audit window.
DELETE FROM delivery_screenshots ds
USING deliveries d
WHERE ds.delivery_id = d.id
  AND d.week_end < CURRENT_DATE - INTERVAL '14 days';

DELETE FROM extra_farm_screenshots efs
USING extra_farm_requests efr, deliveries d
WHERE efs.extra_farm_id = efr.id
  AND efr.delivery_id = d.id
  AND d.week_end < CURRENT_DATE - INTERVAL '14 days';

-- 6) Reclaim disk after deletes/updates.
-- If the database is completely full, increase the Railway volume first,
-- then run these one at a time during low traffic because VACUUM FULL locks tables.
VACUUM FULL deliveries;
VACUUM FULL delivery_screenshots;
VACUUM FULL extra_farm_screenshots;

-- 7) Emergency option only: uncomment to remove all screenshot payloads immediately.
-- TRUNCATE TABLE delivery_screenshots;
-- TRUNCATE TABLE extra_farm_screenshots;
-- UPDATE deliveries SET screenshot_url = NULL WHERE screenshot_url IS NOT NULL;
