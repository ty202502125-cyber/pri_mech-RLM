const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = require('./app');
const pool = require('./config/db');
const { expirePaymentReservations } = require('./services/reservation-expiry');

const port = Number(process.env.PORT) || 3000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Backend startup failed: set JWT_SECRET in BACKEND/.env to a private value with at least 32 characters.');
  process.exitCode = 1;
} else {
  const server = app.listen(port, () => {
    console.log(`Bicycle mechanic API listening on http://localhost:${port}`);
    pool.query('SELECT 1')
      .then(() => console.log('MySQL connection is ready.'))
      .catch((error) => console.warn(`MySQL is not ready yet: ${error.code || error.message}`));
    const expire = () => expirePaymentReservations(pool)
      .then(count => { if (count) console.log(`Expired ${count} unpaid booking reservation(s).`); })
      .catch(error => console.error(`Could not expire unpaid booking reservations: ${error.code || 'DATABASE_ERROR'}: ${error.message}`));
    expire();
    const expiryTimer = setInterval(expire, 60 * 1000);
    server.on('close', () => clearInterval(expiryTimer));
  });

  server.on('error', (error) => {
    console.error(`Backend could not listen on port ${port}: ${error.message}`);
    process.exitCode = 1;
  });
}
