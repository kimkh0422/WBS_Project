-- App stores progress with round2 (e.g. 82.5%); column was integer → PostgreSQL 22P02.
ALTER TABLE tasks
  ALTER COLUMN progress TYPE numeric(6, 2)
  USING round(progress::numeric, 2);

COMMENT ON COLUMN tasks.progress IS 'Completion 0–100 %. Decimals allowed (manual entry, rollups).';
