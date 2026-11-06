USE bicycle_mechanic;

-- Clearly labeled development examples. Replace prices and descriptions before launch.
INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection)
SELECT 'Safety check', 'Basic inspection of brakes, tires, drivetrain, and fasteners.', 350.00, 45, FALSE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Safety check');

INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection)
SELECT 'Flat tire repair', 'Tube or tire replacement. Final parts cost depends on the bicycle.', 250.00, 30, FALSE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Flat tire repair');

INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection)
SELECT 'Full tune-up', 'Adjustment and inspection of key bicycle systems; may require inspection.', 1200.00, 120, TRUE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Full tune-up');
