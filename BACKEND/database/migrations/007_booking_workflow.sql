USE bicycle_mechanic;

-- Upgrade the first booking release to the expanded lifecycle. This migration
-- is intended to run once after 001_initial.sql through 006_int_unsigned_ids.sql.
ALTER TABLE bookings
  ADD COLUMN bicycle_id INT UNSIGNED NULL AFTER customer_id,
  ADD KEY idx_bookings_bicycle (bicycle_id),
  MODIFY status ENUM(
    'pending_review', 'confirmed', 'awaiting_customer', 'rescheduled',
    'awaiting_customer_response', 'in_progress', 'completed', 'rejected',
    'cancelled', 'no_show'
  ) NOT NULL DEFAULT 'pending_review',
  ADD CONSTRAINT fk_bookings_bicycle
    FOREIGN KEY (bicycle_id) REFERENCES bicycles(id) ON DELETE SET NULL;

-- Remaining workflow tables are created by the additive setup_full.sql
-- schema, which also preserves existing rows and seeds missing service defaults.
