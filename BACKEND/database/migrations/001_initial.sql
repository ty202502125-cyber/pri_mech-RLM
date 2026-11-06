CREATE DATABASE IF NOT EXISTS bicycle_mechanic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bicycle_mechanic;

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

CREATE TABLE IF NOT EXISTS bookings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_ref VARCHAR(20) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  bicycle_type VARCHAR(80) NOT NULL,
  bicycle_brand VARCHAR(100) NULL,
  bicycle_model VARCHAR(100) NULL,
  problem_description VARCHAR(2000) NOT NULL,
  preferred_at DATETIME NOT NULL,
  scheduled_at DATETIME NULL,
  status ENUM('pending_review', 'awaiting_customer_response', 'confirmed', 'rejected', 'cancelled', 'completed') NOT NULL DEFAULT 'pending_review',
  admin_note VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  confirmed_slot DATETIME GENERATED ALWAYS AS (CASE WHEN status = 'confirmed' THEN scheduled_at ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_ref (booking_ref),
  UNIQUE KEY uq_bookings_confirmed_slot (confirmed_slot),
  KEY idx_bookings_customer_created (customer_id, created_at),
  KEY idx_bookings_status_preferred (status, preferred_at),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_services (
  booking_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id, service_id),
  KEY idx_booking_services_service (service_id),
  CONSTRAINT fk_booking_services_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_services_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
