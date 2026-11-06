USE bicycle_mechanic;

CREATE TABLE IF NOT EXISTS booking_groups (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_ref VARCHAR(24) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  payment_choice ENUM('together', 'separate') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_groups_ref (group_ref),
  KEY idx_booking_groups_customer (customer_id, created_at),
  CONSTRAINT fk_booking_groups_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_group_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id INT UNSIGNED NOT NULL,
  method ENUM('gcash', 'bank_transfer') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  transaction_ref VARCHAR(160) NOT NULL,
  proof_path VARCHAR(255) NOT NULL,
  status ENUM('submitted', 'verified', 'rejected') NOT NULL DEFAULT 'submitted',
  admin_note VARCHAR(1000) NULL,
  verified_by INT UNSIGNED NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_group_payment_ref (transaction_ref),
  KEY idx_booking_group_payment_status (group_id, status, created_at),
  CONSTRAINT chk_booking_group_payment_amount CHECK (amount > 0),
  CONSTRAINT fk_booking_group_payment_group FOREIGN KEY (group_id) REFERENCES booking_groups(id) ON DELETE RESTRICT,
  CONSTRAINT fk_booking_group_payment_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_photos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_booking_photos_booking (booking_id, created_at),
  CONSTRAINT fk_booking_photos_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

DROP PROCEDURE IF EXISTS migrate_009_grouped_bicycle_bookings;
DELIMITER //
CREATE PROCEDURE migrate_009_grouped_bicycle_bookings()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'bookings'
      AND column_name = 'booking_group_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN booking_group_id INT UNSIGNED NULL AFTER customer_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND table_name = 'bookings'
      AND column_name = 'booking_group_id' AND referenced_table_name = 'booking_groups'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_group
      FOREIGN KEY (booking_group_id) REFERENCES booking_groups(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payment_transactions'
      AND column_name = 'booking_group_payment_id'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN booking_group_payment_id INT UNSIGNED NULL AFTER payment_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND table_name = 'payment_transactions'
      AND column_name = 'booking_group_payment_id'
      AND referenced_table_name = 'booking_group_payments'
  ) THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT fk_payment_transaction_group_payment
      FOREIGN KEY (booking_group_payment_id) REFERENCES booking_group_payments(id) ON DELETE RESTRICT;
  END IF;
END//
DELIMITER ;

CALL migrate_009_grouped_bicycle_bookings();
DROP PROCEDURE migrate_009_grouped_bicycle_bookings;
