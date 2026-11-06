# React pages

Each file in this folder is one screen mapped from a URL in `src/App.jsx`:

- `HomePage.jsx` — public workshop home page, mechanic profile, work gallery, and reviews (`/`).
- `ServicesPage.jsx` — the service menu and starting prices (`/services`).
- `LoginPage.jsx` — sign-in screen (`/login`).
- `RegisterPage.jsx` — customer account creation (`/register`).
- `BookingPage.jsx` — customer service request form (`/book`).
- `MyBookingsPage.jsx` — signed-in customer bookings and updates (`/account`).
- `MechanicQueuePage.jsx` — mechanic request queue and appointment actions (`/admin`).
- `AuthPage.jsx` — shared sign-in and registration form used by the two auth pages.

Shared UI such as the header, footer, service list, mechanic section, and reviews
lives in `src/components/`. Mechanic profile details and image lists live in
`src/data/mechanic.js`.
