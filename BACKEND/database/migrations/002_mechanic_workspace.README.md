# Mechanic workspace migration

Run these files once, in order, in MySQL Workbench:

1. `001_initial.sql` (skip this if the original tables already exist).
2. `../seeds/001_demo_services.sql` (optional example service data).
3. `002_mechanic_workspace.sql` (build gallery, events, work sessions, booking controls, and reset tokens).
4. `003_verified_reviews.sql` (customer reviews submitted only after a booking is completed).
5. `004_mechanic_certifications.sql` (certificates managed in the mechanic workspace).

Then set `BOOKING_CONTROL_PIN` in `BACKEND/.env` to 4–12 digits and run `npm run create-admin` from the `BACKEND` folder. The script saves only a bcrypt hash of the PIN to `app_settings`.

The workshop dashboard stores uploaded build photos under `BACKEND/uploads/`; keep that folder persistent when deploying. For production password resets, connect an email delivery provider before publishing. In development, the reset page link is shown in the app after submitting the form.
