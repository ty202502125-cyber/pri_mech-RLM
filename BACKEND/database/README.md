# MySQL setup

Use [`setup_full.sql`](setup_full.sql) in MySQL Workbench for a new database. For an existing database, run `npm run db:setup` from `BACKEND`; it applies the repeatable additive schema updates, including the latest grouped-booking changes.

To apply the latest grouped-booking update manually in MySQL Workbench instead, connect to the target schema and execute [`migrations/009_grouped_bicycle_bookings.sql`](migrations/009_grouped_bicycle_bookings.sql) as a script (it uses `DELIMITER`). Then run `npm run db:check` to verify the configured database connection and required tables. The migration preserves existing booking/payment rows.

Entity record IDs use `INT UNSIGNED AUTO_INCREMENT PRIMARY KEY`; foreign-key ID columns use the matching `INT UNSIGNED` type. If an existing database still uses `BIGINT UNSIGNED`, back it up and run `npm run db:migrate:int-ids` from `BACKEND`. The migration checks ID capacity and expected foreign keys before changing column types, preserves row IDs, and restores the foreign-key links.

The script creates missing tables, adds the default booking settings, and inserts the three sample services only if they are absent. It does not drop tables, clear customer or booking rows, replace service prices, or overwrite an existing emergency PIN hash. It is safe to run again for databases built from this project's `001_initial.sql` schema.

After running the SQL, set `BOOKING_CONTROL_PIN` in `BACKEND/.env` and run `npm run create-admin` from the `BACKEND` folder. Keep `ADMIN_PASSWORD` set to the password you want the admin account to use; this command updates that account from the environment values.

After updating the application, run `npm run db:setup` from `BACKEND` before restarting the API. This adds the payment-reservation/capacity fields and grouped-booking, combined-payment, and photo tables/columns to existing databases without dropping booking or customer data. If unpaid reservation expiry logs `ER_BAD_FIELD_ERROR`, open `/api/health` and run this setup command when it reports missing columns.

Featured build image files are stored on the backend filesystem under `BACKEND/uploads/`; the database stores their paths. Back up/persist that directory too. Password reset links are displayed in development; a production email provider is required to deliver reset links to customers.

Customer bicycle photos are stored separately under `BACKEND/private-uploads/bicycle-photos/` and are only served through authenticated booking-photo endpoints. Keep this directory private and include it in protected backups.
