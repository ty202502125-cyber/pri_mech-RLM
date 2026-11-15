# Spoke & Wrench Bicycle Service — RLM Stack

This project uses React, Laravel/PHP, and MySQL. The React/Vite application remains in `FRONTEND/`; the Laravel API lives at `BACKEND/`.

## Migration status

- The existing MySQL database `bicycle_mechanic` was inspected and backed up before Laravel setup. No Laravel migrations were run against it.
- The Laravel API connects through ignored `BACKEND/.env`; Sanctum cookie authentication and existing roles are configured.
- Core routes cover authentication, profiles, services, availability, bookings/groups, booking photos, payments, repairs, notifications, mechanic content, and admin scheduling/workflow.
- The existing custom schedule was preserved. See `migration-backup/mysql-schema-report.json` for the schema inventory and before-state row counts.
- The isolated test schema `bicycle_mechanic_rlm_test_20261112` is separate from live customer records.
- Original upload binaries were missing at migration start. Database paths remain, but SQL backups cannot restore those files.
- Original Express environment/manifests are preserved as `BACKEND/.env.express*` and `BACKEND/package*.express.json`; original backend and existing worktree changes are backed up in `migration-backup/`.

## Local requirements

- Windows PowerShell, PHP 8.5, Composer 2, MySQL 8.0+, Node.js and npm.
- Local PHP is in `BACKEND/.tools/php/`; Composer PHAR is `BACKEND/.tools/composer.phar`. Neither is on system PATH.
- PHP extensions used by Laravel include `curl`, `fileinfo`, `intl`, `mbstring`, `openssl`, `pdo_mysql`, and `zip`.

## Run the applications

Open two PowerShell terminals from the project root.

Terminal 1 — Laravel API:

```powershell
Set-Location .\BACKEND
.\.tools\php\php.exe artisan serve --host=127.0.0.1 --port=8000
```

Terminal 2 — React/Vite:

```powershell
Set-Location .\FRONTEND
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api`, `/sanctum`, and `/uploads` to Laravel on port 8000. The API health endpoint is `http://127.0.0.1:8000/api/health`.

The ignored `BACKEND/.env` points to the existing `bicycle_mechanic` database. Never commit environment files. Do not run `php artisan migrate` against this pre-existing schema; use the SQL files under `BACKEND/database/` as reference only. The dated SQL dump and before-state report are in ignored `migration-backup/`.

The live workshop hours differ from generic hours in the original project brief. The inspected MySQL schedule remains the source of truth.

## Dependencies

Laravel 13 and Sanctum provide the API and SPA sessions; React 19, React Router, Axios, and Vite remain the frontend. Laravel Boost is installed as development tooling. Run `npm install` from `FRONTEND/`; run `..\.tools\php\php.exe .\.tools\composer.phar install` from `BACKEND/` to install PHP dependencies.

## Verification

- All 77 legacy Express method/path pairs have Laravel equivalents; Laravel registers 78 API routes. `/uploads/{path}` is a separate web route.
- PHP syntax checks, Composer validation, Laravel route registration, Pint, and the two starter PHPUnit tests passed.
- Read-only HTTP checks passed for health/MySQL, services, booking status, schedules, availability, unauthenticated auth, CSRF cookies, and CORS preflight.
- On the isolated test database, customer/admin authentication and role guards, profile/bicycle CRUD, booking approval, separate and group payment verification, repair estimate approval through completion, review, admin service/announcement/schedule CRUD, and public/private upload authorization passed.
- `npm run build` passed (85 modules). `npm run lint` reported six existing React set-state-in-effect warnings and no errors.
- Live row counts across all 29 tables still match the before-migration report. One synthetic customer and bicycle created during an early smoke attempt were deleted and counts were rechecked. Current `users` and `bicycles` auto-increment values are below their pre-migration values.

Browser-level UI checks and less common refund/cash, cancellation/rejection, and location authorization paths remain follow-up checks.
