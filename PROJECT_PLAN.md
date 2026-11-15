# RLM Migration Plan

## Objective

Replace the existing Express backend with Laravel while retaining React/Vite, the MySQL schema and records, and existing business workflows.

## Current state

- React/Vite source was restored from Git HEAD as explicitly requested. Only API/CSRF and Vite proxy wiring changed.
- Laravel 13 and Sanctum are installed in `BACKEND/`. Local PHP 8.5 and Composer 2 are in `BACKEND/.tools/`.
- Laravel uses the existing `bicycle_mechanic` schema through Query Builder. No Laravel schema migration was run against the live database.
- Existing custom hours and records were inspected and preserved. The SQL export and before-state report are in ignored `migration-backup/`.
- Isolated test schema `bicycle_mechanic_rlm_test_20261112` contains synthetic workflow data, separate from live records.
- Original Express files and pre-existing worktree edits are preserved in `migration-backup/`. Original uploads were missing at migration start; database paths remain preserved.

## Migration stages

1. **Assessment and backup — complete.** Inventoried source, routes and database; archived the original backend/frontend, changes, SQL dump and before-state report.
2. **Environment — complete.** Verified local PHP/Composer, installed Laravel/Sanctum and configured the live connection without migrating its schema.
3. **API port — complete.** All 77 legacy method/path pairs have Laravel equivalents; core customer/admin workflows were exercised against the isolated database.
4. **Frontend integration — API wiring complete.** Existing React pages/styles remain; Vite proxies to Laravel and Axios initializes Sanctum CSRF. Build and lint passed; browser UI checks remain.
5. **Safe workflow tests — core paths complete.** Isolated HTTP flows covered authentication, role guards, profile/bicycle CRUD, booking approval, separate/group payments, repair estimates through completion, review, schedule changes, catalog/content CRUD, and upload authorization. Refund/cash, cancellation/rejection and location authorization remain follow-up checks.
6. **Cutover — complete.** Laravel was promoted to `BACKEND/`; Express env/manifests and prior worktree edits were preserved. Root commands, route registration, tests and live read-only health checks passed.

## Business/data rules

- Customer data stays scoped to the authenticated user. Public registration only creates customer accounts; admin roles remain private.
- Preserve booking transitions, capacity, reservation rules, manual payment verification, estimates, repair history and group payments.
- Private workshop location is only returned under the existing fully paid booking rule.
- The actual MySQL schedule remains the source of truth.
- Preserve the live schema. Do not run Laravel migrations or recreate tables against it.

## Local commands

Laravel API (PowerShell from project root):

```powershell
Set-Location .\BACKEND
.\.tools\php\php.exe artisan serve --host=127.0.0.1 --port=8000
```

React/Vite (second terminal):

```powershell
Set-Location .\FRONTEND
npm run dev
```

The Vite proxy forwards `/api`, `/sanctum`, and `/uploads`. See `README.md` for requirements and database safeguards.

## Verification

- PHP syntax, Composer validation, Pint, route registration (78 API routes), and two starter PHPUnit tests passed. All 77 Express API method/path pairs are represented.
- Read-only health, MySQL connectivity, services, status, schedules, availability, unauthenticated auth, CSRF and CORS checks passed.
- React production build passed. Lint had six existing set-state-in-effect warnings and no errors.
- Isolated database HTTP tests passed for customer/admin authentication, CRUD, booking approval, separate and combined payment, repair completion/review, schedule updates, and upload authorization.
- All 29 live table row counts still match the before-migration report. An early smoke attempt created a synthetic customer and bicycle in live MySQL; both were deleted and counts rechecked. Current `users` and `bicycles` auto-increment values remain below the captured pre-migration values.
- Browser UI checks and the less common business paths listed above remain follow-up work.
