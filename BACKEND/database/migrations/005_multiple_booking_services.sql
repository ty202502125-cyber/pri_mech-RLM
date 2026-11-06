USE bicycle_mechanic;

-- Adds support for requesting multiple repair services in a single booking.
-- Existing bookings keep their primary service_id and continue to display correctly.
CREATE TABLE IF NOT EXISTS booking_services (
  booking_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id, service_id),
  KEY idx_booking_services_service (service_id),
  CONSTRAINT fk_booking_services_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_services_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Copy each existing booking's original service into the new junction table.
INSERT IGNORE INTO booking_services (booking_id, service_id)
SELECT id, service_id FROM bookings;
