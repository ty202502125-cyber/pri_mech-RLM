-- Additive workflow improvements: concurrent slot capacity, replies/reschedules,
-- pickup tracking, payment review reminders, and editable mechanic profile.
DELIMITER //
CREATE PROCEDURE apply_reliability_workflow_schema()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'bookings'
      AND index_name = 'uq_bookings_confirmed_slot' AND non_unique = 0
  ) THEN
    ALTER TABLE bookings DROP INDEX uq_bookings_confirmed_slot;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'bookings'
      AND index_name = 'idx_bookings_confirmed_slot'
  ) THEN
    ALTER TABLE bookings ADD KEY idx_bookings_confirmed_slot (confirmed_slot);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'bookings' AND column_name = 'customer_response'
  ) THEN
    ALTER TABLE bookings ADD COLUMN customer_response VARCHAR(1000) NULL AFTER problem_description;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'booking_reschedules' AND column_name = 'previous_booking_status'
  ) THEN
    ALTER TABLE booking_reschedules ADD COLUMN previous_booking_status VARCHAR(40) NULL AFTER proposed_by;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'repair_records' AND column_name = 'picked_up_at'
  ) THEN
    ALTER TABLE repair_records ADD COLUMN picked_up_at DATETIME NULL AFTER completion_notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payment_transactions' AND column_name = 'review_reminder_count'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN review_reminder_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER verified_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payment_transactions' AND column_name = 'review_reminded_at'
  ) THEN
    ALTER TABLE payment_transactions ADD COLUMN review_reminded_at DATETIME NULL AFTER review_reminder_count;
  END IF;
END//
DELIMITER ;

CALL apply_reliability_workflow_schema();
DROP PROCEDURE apply_reliability_workflow_schema;

CREATE TABLE IF NOT EXISTS mechanic_profile (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  full_name VARCHAR(120) NOT NULL,
  role VARCHAR(160) NOT NULL,
  bio TEXT NOT NULL,
  highlights JSON NOT NULL,
  expertise JSON NOT NULL,
  licences JSON NOT NULL,
  agreements JSON NOT NULL DEFAULT (JSON_ARRAY()),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_mechanic_profile_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT IGNORE INTO mechanic_profile (id, full_name, role, bio, highlights, expertise, licences)
VALUES (
  1,
  'Palluh, Abdallah J.',
  'Head Mechanic & Student',
  'For more than four years, I have worked on road bikes, mountain bikes, fixed-gear builds, and everyday commuters. I provide practical tune-ups, drivetrain troubleshooting, wheel and tyre work, brake adjustments, and upgrades for different riding styles. Every rider deserves careful attention, clear repair options, and recommendations that fit the bike and the way they ride.',
  JSON_ARRAY(
    JSON_OBJECT('icon', 'wrench', 'val', '4+ years', 'sub', 'Professional experience'),
    JSON_OBJECT('icon', 'bike', 'val', '200+', 'sub', 'Bicycles serviced'),
    JSON_OBJECT('icon', 'tools', 'val', '6', 'sub', 'Service specialties'),
    JSON_OBJECT('icon', 'pin', 'val', 'Zamboanga City', 'sub', 'Based locally')
  ),
  JSON_ARRAY(
    JSON_OBJECT('area', 'Road & gravel', 'detail', 'Race-ready tune-ups, fit adjustments, shifting checks, and reliable long-distance setups.'),
    JSON_OBJECT('area', 'Mountain bike', 'detail', 'Suspension checks, dropper posts, tubeless conversions, and trail-focused tuning.'),
    JSON_OBJECT('area', 'Drivetrain & gears', 'detail', 'Accurate indexing, cable tension, derailleur alignment, and Di2 or AXS setup checks.'),
    JSON_OBJECT('area', 'Wheels & tyres', 'detail', 'Wheel truing, spoke replacement, hub bearings, punctures, and tubeless setup.'),
    JSON_OBJECT('area', 'Brakes', 'detail', 'Hydraulic bleeding, rotor alignment, pad replacement, and rim-brake adjustment.'),
    JSON_OBJECT('area', 'City & commuter', 'detail', 'Practical lighting, racks, fenders, drivetrain care, and dependable daily-bike setup.')
  ),
  JSON_ARRAY(
    'DTI-Registered Business — Zamboanga City',
    'BIR Certificate of Registration',
    'Barangay Business Permit — current year'
  )
);
