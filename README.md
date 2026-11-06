# Spoke & Wrench Bicycle Service

Responsive portfolio and first booking workflow for a bicycle mechanic. It supports multiple customer accounts, account-scoped booking history, and a separate mechanic admin queue. MySQL is the source of truth.

## Project structure

- `FRONTEND/` — React/Vite public website, registration/login, customer booking pages, and admin interface.
- `BACKEND/` — Express REST API, MySQL connection, authentication, migration, and development seed data.
- `PROJECT_PLAN.md` — workflow and working assumptions.

## Run locally

Requirements: Node.js/npm and MySQL 8.0 or newer.

1. Start MySQL. In a MySQL client connected as an administrator, create the application account (replace the example password with the same password you will put in `.env`):

   ```sql
   CREATE USER 'bicycle_app'@'localhost' IDENTIFIED BY 'replace_with_a_local_password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON bicycle_mechanic.* TO 'bicycle_app'@'localhost';
   ```

2. In `BACKEND`, run `npm run db:setup` to create or safely update the MySQL schema, then run `npm run db:check`. This preserves existing customer, booking, and service rows. For a fresh install, `BACKEND/database/seeds/001_demo_services.sql` is optional; replace sample services and prices before using the site with real customers.
3. In `BACKEND`, copy `.env.example` to `.env`. Set `DB_HOST=localhost`, `DB_PORT=3306`, `DB_NAME=bicycle_mechanic`, `DB_USER` to the MySQL username you use (the example is `bicycle_app`; local Workbench `root` also works), and `DB_PASSWORD` to that account's password. Set `JWT_SECRET` to a unique random value of at least 32 characters. Set a private `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the mechanic login.
4. In `BACKEND`, run `npm install`, then `npm run create-admin` to create or update the mechanic login using the credentials in `.env`.
5. In `FRONTEND`, run `npm install`.
6. Start the backend from `BACKEND` with `npm run dev`. The API starts even if MySQL is not connected yet, so you can work on the interface. Database-backed requests will return a setup error until `.env`, the migration, and the seed are ready.
7. Start the frontend from `FRONTEND` with `npm run dev` and open the URL Vite prints (normally `http://localhost:5173`).

The Vite server proxies `/api` requests to the backend at `http://127.0.0.1:3000`. Check `http://localhost:3000/api/health`; it reports whether the API, database tables, and required schema columns are ready. If it reports missing schema items, run `npm run db:setup` from `BACKEND` and restart the API. The public home page can render without MySQL, but services, accounts, bookings, and the mechanic queue need the database configured and seeded.

## Current booking and payment flow

- Public visitors can browse the mechanic profile and active services. Customers register, manage bicycles, submit service requests, and see only bookings belonging to their account.
- Customers can submit one booking group for up to ten bicycles. Each bicycle has its own selected services, issue description, preferred drop-off time, and up to three private JPEG/PNG/WebP photos (10 MB each). Registered bicycles cannot be selected twice in one group.
- Customers choose to pay together or separately. A combined payment can be submitted after every bicycle in the group is approved; the mechanic verifies that payment once, confirming all covered bicycle appointments. Separate payments continue through the existing per-booking verification flow.
- The mechanic reviews a request, proposes a drop-off time, and approves it. Approval temporarily reserves daily repair capacity and that drop-off slot for two hours.
- Customers submit e-wallet/bank-transfer references and proof. This is manual payment verification, not an online card gateway. Only a mechanic-verified full payment confirms the appointment and releases the private workshop address to that booking's customer.
- Daily repair capacity uses service-duration snapshots; drop-off limits are configured separately. The API checks both under a transaction when a booking is approved. Expired unpaid reservations release capacity.
- The admin workspace includes booking review, manual payment verification, weekly availability/capacity settings, private address settings, and service/profile catalog management.

The backend uses Asia/Manila for the weekly schedule and supports a configurable daily repair capacity and maximum bicycles per drop-off slot. Run `npm run db:setup` after updating the project, and configure working days and the private address in the mechanic workspace before accepting live bookings. Booking photos are stored outside the public uploads directory under `BACKEND/private-uploads/bicycle-photos/`; back up and protect this directory as private customer data.

## Security notes

Customer sign-up always creates the `customer` role. Public requests cannot create administrators. Passwords are stored as bcrypt hashes; the browser uses an HttpOnly session cookie, and API authorization is checked server-side. `.env` is ignored by Git. Use HTTPS, secure secrets, rate limits, and least-privilege MySQL credentials in production.

## Scope boundaries

The configured payment flow is manual proof submission and mechanic verification. A payment-provider integration for automatic e-wallet/card processing, provider webhooks, and customer email delivery still requires a provider account, credentials, and deployment configuration. Review the project plan before enabling the site for real customers.
