-- One-time conversion from BIGINT UNSIGNED to INT UNSIGNED.
-- Run only after backing up the database and confirming IDs fit in INT UNSIGNED (0..4294967295).
-- Existing ID values and rows are preserved. The primary keys remain unique.
USE bicycle_mechanic;

-- Drop related foreign keys first so both sides can be converted together.
ALTER TABLE bookings
  DROP FOREIGN KEY fk_bookings_customer,
  DROP FOREIGN KEY fk_bookings_service;
ALTER TABLE booking_services
  DROP FOREIGN KEY fk_booking_services_booking,
  DROP FOREIGN KEY fk_booking_services_service;
ALTER TABLE password_reset_tokens
  DROP FOREIGN KEY fk_password_reset_user;
ALTER TABLE customer_reviews
  DROP FOREIGN KEY fk_review_booking,
  DROP FOREIGN KEY fk_review_customer;

ALTER TABLE users MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE services MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE bookings
  MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY customer_id INT UNSIGNED NOT NULL,
  MODIFY service_id INT UNSIGNED NOT NULL;
ALTER TABLE booking_services
  MODIFY booking_id INT UNSIGNED NOT NULL,
  MODIFY service_id INT UNSIGNED NOT NULL;
ALTER TABLE mechanic_builds MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE mechanic_certifications MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE announcements MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE work_sessions MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE password_reset_tokens
  MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY user_id INT UNSIGNED NOT NULL;
ALTER TABLE customer_reviews
  MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY booking_id INT UNSIGNED NOT NULL,
  MODIFY customer_id INT UNSIGNED NOT NULL;

-- Restore all relationships with matching INT UNSIGNED column types.
ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bookings_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT;
ALTER TABLE booking_services
  ADD CONSTRAINT fk_booking_services_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_booking_services_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT;
ALTER TABLE password_reset_tokens
  ADD CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE customer_reviews
  ADD CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_review_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;
