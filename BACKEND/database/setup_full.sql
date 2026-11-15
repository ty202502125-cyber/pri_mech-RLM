-- Spoke & Wrench complete database setup.
-- Safe to run again: CREATE TABLE IF NOT EXISTS and INSERT IGNORE preserve existing rows.
-- This script never drops tables, truncates data, or replaces existing services/settings.
-- Entity IDs use INT UNSIGNED AUTO_INCREMENT PRIMARY KEY. IDs can repeat across
-- different tables; booking_services uses a composite key and app_settings uses its setting name.

CREATE DATABASE IF NOT EXISTS bicycle_mechanic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bicycle_mechanic;

-- Accounts
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('customer', 'admin') NOT NULL DEFAULT 'customer',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_active (role, is_active)
) ENGINE=InnoDB;

-- Optional extended customer profile (the users table remains the login identity).
CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id INT UNSIGNED NOT NULL,
  phone VARCHAR(32) NULL,
  address VARCHAR(500) NULL,
  profile_image_url VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_customer_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- A customer may register multiple bicycles; historical bookings retain a nullable reference.
CREATE TABLE IF NOT EXISTS bicycles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  brand VARCHAR(100) NULL,
  model VARCHAR(100) NULL,
  category VARCHAR(80) NOT NULL,
  frame_details VARCHAR(160) NULL,
  description VARCHAR(1000) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bicycles_customer (customer_id, is_active),
  CONSTRAINT fk_bicycles_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

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

-- Services
CREATE TABLE IF NOT EXISTS services (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  starting_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  requires_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_services_active (is_active, name),
  CONSTRAINT chk_services_price CHECK (starting_price >= 0),
  CONSTRAINT chk_services_duration CHECK (estimated_minutes > 0)
) ENGINE=InnoDB;

-- Customer booking requests and mechanic appointments
CREATE TABLE IF NOT EXISTS bookings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_ref VARCHAR(20) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  booking_group_id INT UNSIGNED NULL,
  bicycle_id INT UNSIGNED NULL,
  service_id INT UNSIGNED NOT NULL,
  bicycle_type VARCHAR(80) NOT NULL,
  bicycle_brand VARCHAR(100) NULL,
  bicycle_model VARCHAR(100) NULL,
  problem_description VARCHAR(2000) NOT NULL,
  customer_response VARCHAR(1000) NULL,
  preferred_at DATETIME NOT NULL,
  scheduled_at DATETIME NULL,
  status ENUM('pending_review', 'awaiting_customer_response', 'awaiting_customer', 'rescheduled', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'in_progress', 'rejected', 'cancelled', 'no_show', 'completed') NOT NULL DEFAULT 'pending_review',
  admin_note VARCHAR(1000) NULL,
  reservation_expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  confirmed_slot DATETIME GENERATED ALWAYS AS (CASE WHEN status = 'confirmed' THEN scheduled_at ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_ref (booking_ref),
  KEY idx_bookings_confirmed_slot (confirmed_slot),
  KEY idx_bookings_customer_created (customer_id, created_at),
  KEY idx_bookings_status_preferred (status, preferred_at),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_group FOREIGN KEY (booking_group_id) REFERENCES booking_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_bicycle FOREIGN KEY (bicycle_id) REFERENCES bicycles(id) ON DELETE SET NULL
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

-- Multiple repair services can be requested in one booking.
CREATE TABLE IF NOT EXISTS booking_services (
  booking_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  service_name_snapshot VARCHAR(120) NOT NULL DEFAULT '',
  unit_price_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  duration_snapshot SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id, service_id),
  KEY idx_booking_services_service (service_id),
  CONSTRAINT fk_booking_services_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_services_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
INSERT IGNORE INTO booking_services (booking_id, service_id)
SELECT id, service_id FROM bookings;

-- Existing booking_services tables may predate the snapshot columns. The
-- database setup script adds those columns before applying this file and then
-- backfills historical rows without changing their selected service IDs.

-- Weekly opening hours and one-off closures used when confirming appointments.
CREATE TABLE IF NOT EXISTS availability_schedules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  day_of_week TINYINT UNSIGNED NOT NULL,
  is_working_day BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at TIME NULL,
  closes_at TIME NULL,
  break_starts_at TIME NULL,
  break_ends_at TIME NULL,
  slot_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  daily_capacity_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 600,
  max_dropoffs_per_slot SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_availability_day (day_of_week),
  CONSTRAINT chk_availability_day CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_availability_slot CHECK (slot_minutes BETWEEN 15 AND 1440),
  CONSTRAINT chk_availability_dropoffs CHECK (max_dropoffs_per_slot > 0)
) ENGINE=InnoDB;
INSERT IGNORE INTO availability_schedules (day_of_week, is_working_day, opens_at, closes_at, slot_minutes)
VALUES (0, 0, NULL, NULL, 60), (1, 0, NULL, NULL, 60), (2, 0, NULL, NULL, 60),
       (3, 0, NULL, NULL, 60), (4, 0, NULL, NULL, 60), (5, 0, NULL, NULL, 60),
       (6, 0, NULL, NULL, 60);

CREATE TABLE IF NOT EXISTS unavailable_dates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  reason VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_unavailable_dates (starts_at, ends_at),
  CONSTRAINT chk_unavailable_range CHECK (ends_at > starts_at),
  CONSTRAINT fk_unavailable_dates_admin FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_status_history (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  previous_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NOT NULL,
  note VARCHAR(1000) NULL,
  changed_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_booking_history (booking_id, created_at),
  CONSTRAINT fk_booking_history_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_history_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_reschedules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  proposed_by INT UNSIGNED NOT NULL,
  previous_booking_status VARCHAR(40) NULL,
  proposed_at DATETIME NOT NULL,
  response ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  response_note VARCHAR(1000) NULL,
  responded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reschedule_booking (booking_id, response, created_at),
  CONSTRAINT fk_reschedule_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_reschedule_admin FOREIGN KEY (proposed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- One repair summary per booking; detailed progress is retained in status history.
CREATE TABLE IF NOT EXISTS repair_records (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  status ENUM('bicycle_received', 'inspection', 'awaiting_customer_approval', 'in_progress', 'quality_check', 'ready_for_pickup', 'completed') NOT NULL DEFAULT 'bicycle_received',
  inspection_notes TEXT NULL,
  estimate_amount DECIMAL(10,2) NULL,
  estimate_status ENUM('not_required', 'pending', 'approved', 'declined') NOT NULL DEFAULT 'not_required',
  final_amount DECIMAL(10,2) NULL,
  completion_notes TEXT NULL,
  picked_up_at DATETIME NULL,
  warranty_until DATE NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repair_booking (booking_id),
  CONSTRAINT chk_repair_estimate CHECK (estimate_amount IS NULL OR estimate_amount >= 0),
  CONSTRAINT chk_repair_final CHECK (final_amount IS NULL OR final_amount >= 0),
  CONSTRAINT fk_repair_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_repair_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS repair_status_history (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  repair_id INT UNSIGNED NOT NULL,
  previous_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NOT NULL,
  note VARCHAR(1000) NULL,
  changed_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_repair_history (repair_id, created_at),
  CONSTRAINT fk_repair_history_record FOREIGN KEY (repair_id) REFERENCES repair_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_repair_history_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS repair_parts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  repair_id INT UNSIGNED NOT NULL,
  part_name VARCHAR(160) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_repair_parts_repair (repair_id),
  CONSTRAINT chk_repair_part_quantity CHECK (quantity > 0),
  CONSTRAINT chk_repair_part_cost CHECK (unit_cost >= 0),
  CONSTRAINT fk_repair_parts_record FOREIGN KEY (repair_id) REFERENCES repair_records(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  estimated_amount DECIMAL(10,2) NULL,
  final_amount DECIMAL(10,2) NULL,
  status ENUM('pending', 'partially_paid', 'paid', 'refunded', 'expired') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_booking (booking_id),
  CONSTRAINT chk_payment_estimated CHECK (estimated_amount IS NULL OR estimated_amount >= 0),
  CONSTRAINT chk_payment_final CHECK (final_amount IS NULL OR final_amount >= 0),
  CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id INT UNSIGNED NOT NULL,
  booking_group_payment_id INT UNSIGNED NULL,
  method ENUM('cash', 'gcash', 'bank_transfer') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  transaction_ref VARCHAR(160) NULL,
  proof_path VARCHAR(255) NULL,
  status ENUM('pending', 'submitted', 'verified', 'rejected', 'refunded') NOT NULL DEFAULT 'pending',
  admin_note VARCHAR(1000) NULL,
  verified_by INT UNSIGNED NULL,
  verified_at DATETIME NULL,
  review_reminder_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  review_reminded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_transaction_ref (transaction_ref),
  KEY idx_payment_transactions (payment_id, created_at),
  CONSTRAINT chk_payment_transaction_amount CHECK (amount > 0),
  CONSTRAINT fk_payment_transaction_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_transaction_group_payment FOREIGN KEY (booking_group_payment_id) REFERENCES booking_group_payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_transaction_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

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

-- Mechanic featured bicycle builds
CREATE TABLE IF NOT EXISTS mechanic_builds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(140) NOT NULL,
  image_url VARCHAR(255) NOT NULL,
  owner_name VARCHAR(120) NOT NULL,
  social_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_builds_created (created_at)
) ENGINE=InnoDB;

-- Certifications and certificate images managed by the mechanic
CREATE TABLE IF NOT EXISTS mechanic_certifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  body VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  year VARCHAR(20) NOT NULL,
  image_url VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_certifications_created (created_at)
) ENGINE=InnoDB;

-- Events and announcements shown to signed-in customers
CREATE TABLE IF NOT EXISTS announcements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  event_at DATETIME NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_announcements_published (is_published, created_at)
) ENGINE=InnoDB;

-- Mechanic shift timer used by daily work-hour analytics
CREATE TABLE IF NOT EXISTS work_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_work_sessions_started (started_at, ended_at)
) ENGINE=InnoDB;

-- Booking availability and hashed emergency PIN settings
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(80) NOT NULL,
  setting_value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;
INSERT IGNORE INTO app_settings (setting_key, setting_value)
VALUES ('booking_enabled', 'true'), ('emergency_pin_hash', NULL);

-- Short-lived, single-use password reset tokens (only token hashes are stored)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_token_hash (token_hash),
  KEY idx_password_reset_user (user_id, expires_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Verified feedback can only be created through the API for completed bookings
CREATE TABLE IF NOT EXISTS customer_reviews (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(1500) NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_review_booking (booking_id),
  KEY idx_reviews_created (created_at),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- In-app notifications. Payloads contain display context only, never secrets.
CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  type VARCHAR(60) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  related_booking_id INT UNSIGNED NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_unread (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_booking FOREIGN KEY (related_booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Reminder generation is idempotent per customer, bicycle and due date.
CREATE TABLE IF NOT EXISTS maintenance_reminders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  bicycle_id INT UNSIGNED NULL,
  booking_id INT UNSIGNED NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  due_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_maintenance_reminders_due (due_at, sent_at, dismissed_at),
  KEY idx_maintenance_reminders_customer (customer_id, due_at),
  CONSTRAINT fk_maintenance_reminders_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_reminders_bicycle FOREIGN KEY (bicycle_id) REFERENCES bicycles(id) ON DELETE SET NULL,
  CONSTRAINT fk_maintenance_reminders_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Administrative audit trail; retain records even if an account is removed.
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor_created (actor_user_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Optional example services. Existing service rows and prices are left untouched.
INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection)
SELECT 'Safety check', 'Basic inspection of brakes, tires, drivetrain, and fasteners.', 350.00, 45, FALSE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Safety check');

INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection)
SELECT 'Flat tire repair', 'Tube or tire replacement. Final parts cost depends on the bicycle.', 250.00, 30, FALSE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Flat tire repair');

INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection)
SELECT 'Full tune-up', 'Adjustment and inspection of key bicycle systems; may require inspection.', 1200.00, 120, TRUE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Full tune-up');
