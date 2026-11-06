require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

async function main() {
  const fullName = (process.env.ADMIN_NAME || 'Mechanic Administrator').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const emergencyPin = process.env.BOOKING_CONTROL_PIN || '';
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || password.length > 72) {
    throw new Error('Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of 10–72 characters in BACKEND/.env.');
  }
  if (emergencyPin && !/^\d{4,12}$/.test(emergencyPin)) {
    throw new Error('BOOKING_CONTROL_PIN must contain only 4 to 12 digits. Update BACKEND/.env and try again.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES (?, ?, ?, 'admin')
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash), role = 'admin', is_active = 1`,
    [fullName, email, passwordHash],
  );
  if (emergencyPin) {
    const pinHash = await bcrypt.hash(emergencyPin, 12);
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('emergency_pin_hash', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [pinHash],
    );
    console.log('Emergency booking PIN hash saved to app_settings.');
  }
  console.log(`Administrator account is ready for ${email}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
