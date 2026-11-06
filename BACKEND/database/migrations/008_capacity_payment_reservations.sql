USE bicycle_mechanic;

-- This migration is repeatable and preserves existing booking/payment rows.
DROP PROCEDURE IF EXISTS migrate_008_capacity_payment_reservations;
DELIMITER //
CREATE PROCEDURE migrate_008_capacity_payment_reservations()
BEGIN
  DECLARE booking_status_type VARCHAR(1000) DEFAULT '';
  DECLARE payment_status_type VARCHAR(1000) DEFAULT '';

  SELECT COLUMN_TYPE INTO booking_status_type
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bookings' AND column_name = 'status';

  IF LOCATE('awaiting_payment', booking_status_type) = 0
      OR LOCATE('payment_submitted', booking_status_type) = 0
      OR LOCATE('payment_rejected', booking_status_type) = 0 THEN
    ALTER TABLE bookings
      MODIFY status ENUM(
        'pending_review', 'confirmed', 'awaiting_customer', 'rescheduled',
        'awaiting_customer_response', 'awaiting_payment', 'payment_submitted',
        'payment_rejected', 'in_progress', 'completed', 'rejected', 'cancelled',
        'no_show'
      ) NOT NULL DEFAULT 'pending_review';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'bookings'
      AND column_name = 'reservation_expires_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN reservation_expires_at DATETIME NULL AFTER admin_note;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'availability_schedules'
      AND column_name = 'daily_capacity_minutes'
  ) THEN
    ALTER TABLE availability_schedules
      ADD COLUMN daily_capacity_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 600 AFTER slot_minutes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'availability_schedules'
      AND column_name = 'max_dropoffs_per_slot'
  ) THEN
    ALTER TABLE availability_schedules
      ADD COLUMN max_dropoffs_per_slot SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER daily_capacity_minutes;
  END IF;

  SELECT COLUMN_TYPE INTO payment_status_type
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'status';

  IF LOCATE('expired', payment_status_type) = 0 THEN
    ALTER TABLE payments
      MODIFY status ENUM('pending', 'partially_paid', 'paid', 'refunded', 'expired')
        NOT NULL DEFAULT 'pending';
  END IF;
END//
DELIMITER ;

CALL migrate_008_capacity_payment_reservations();
DROP PROCEDURE migrate_008_capacity_payment_reservations;
