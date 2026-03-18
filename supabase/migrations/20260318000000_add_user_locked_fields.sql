-- Add user_locked_fields for preserving manual overrides (e.g., progress)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS user_locked_fields text[] DEFAULT '{}'::text[];

