const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pool = require('../src/config/db');

const requiredTables = [
  'users',
  'services',
  'bookings',
  'booking_services',
  'mechanic_builds',
  'mechanic_certifications',
  'announcements',
  'work_sessions',
  'app_settings',
  'password_reset_tokens',
  'customer_reviews',
  'customer_profiles',
  'bicycles',
  'availability_schedules',
  'unavailable_dates',
  'booking_status_history',
  'booking_reschedules',
  'repair_records',
  'repair_status_history',
  'repair_parts',
  'payments',
  'payment_transactions',
  'booking_groups',
  'booking_group_payments',
  'booking_photos',
  'notifications',
  'maintenance_reminders',
  'audit_logs',
];
const autoIncrementTables = [
  'users', 'services', 'bookings', 'mechanic_builds', 'mechanic_certifications',
  'announcements', 'work_sessions', 'password_reset_tokens', 'customer_reviews',
  'bicycles', 'unavailable_dates', 'booking_status_history', 'booking_reschedules',
  'repair_records', 'repair_status_history', 'repair_parts', 'payments', 'payment_transactions', 'notifications',
  'maintenance_reminders', 'booking_groups', 'booking_group_payments', 'booking_photos',
];

async function main() {
  console.log(`MySQL target: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '3306'}`);
  console.log(`Configured database: ${process.env.DB_NAME || 'bicycle_mechanic'}`);
  console.log(`Configured user: ${process.env.DB_USER || 'bicycle_app'}`);

  const [[connection]] = await pool.query('SELECT DATABASE() AS database_name, CURRENT_USER() AS mysql_user');
  if (connection.database_name !== (process.env.DB_NAME || 'bicycle_mechanic')) {
    throw new Error(`Connected to ${connection.database_name || '(no database selected)'}, which differs from the configured DB_NAME.`);
  }
  console.log(`Connected as: ${connection.mysql_user}`);

  const [rows] = await pool.execute(
    'SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()',
  );
  const existing = new Set(rows.map(row => row.tableName));
  const missing = requiredTables.filter(table => !existing.has(table));

  for (const table of requiredTables) {
    console.log(`${existing.has(table) ? 'OK' : 'MISSING'} ${table}`);
  }

  if (missing.length) {
    console.error(`\nSchema is incomplete. Missing: ${missing.join(', ')}`);
    console.error('Run npm run db:setup from BACKEND to add the missing tables safely.');
    process.exitCode = 1;
    return;
  }

  const [workflowColumns] = await pool.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType
     FROM information_schema.columns WHERE table_schema = DATABASE()
       AND ((TABLE_NAME = 'bookings' AND COLUMN_NAME IN ('reservation_expires_at', 'booking_group_id', 'status'))
         OR (TABLE_NAME = 'payment_transactions' AND COLUMN_NAME = 'booking_group_payment_id')
         OR (TABLE_NAME = 'availability_schedules' AND COLUMN_NAME IN ('daily_capacity_minutes', 'max_dropoffs_per_slot'))
         OR (TABLE_NAME = 'payments' AND COLUMN_NAME = 'status'))`,
  );
  const columnByTable = new Map(workflowColumns.map(row => [`${row.tableName}.${row.columnName}`, row.columnType]));
  const requiredWorkflowColumns = [
    'bookings.reservation_expires_at',
    'bookings.booking_group_id',
    'payment_transactions.booking_group_payment_id',
    'availability_schedules.daily_capacity_minutes',
    'availability_schedules.max_dropoffs_per_slot',
  ];
  const missingWorkflowColumns = requiredWorkflowColumns.filter(column => !columnByTable.has(column));
  const bookingStatuses = ['awaiting_payment', 'payment_submitted', 'payment_rejected'];
  const paymentStatus = columnByTable.get('payments.status') || '';
  const missingBookingStatuses = bookingStatuses.filter(status => !columnByTable.get('bookings.status')?.includes(status));
  const missingPaymentExpiryStatus = !paymentStatus.includes('expired');
  for (const column of requiredWorkflowColumns) {
    console.log(`${columnByTable.has(column) ? 'OK' : 'MISSING'} ${column}`);
  }
  for (const status of bookingStatuses) {
    console.log(`${missingBookingStatuses.includes(status) ? 'MISSING' : 'OK'} bookings.status '${status}'`);
  }
  console.log(`${missingPaymentExpiryStatus ? 'MISSING' : 'OK'} payments.status 'expired'`);
  if (missingWorkflowColumns.length || missingBookingStatuses.length || missingPaymentExpiryStatus) {
    console.error('\nBooking/payment workflow schema is incomplete. Run npm run db:setup from BACKEND, then restart the API.');
    process.exitCode = 1;
    return;
  }

  const [keyRows] = await pool.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, COLUMN_KEY AS columnKey, EXTRA AS extra
     FROM information_schema.columns WHERE table_schema = DATABASE()
     AND (COLUMN_KEY = 'PRI' OR EXTRA LIKE '%auto_increment%')`,
  );
  const keyByTable = new Map();
  for (const row of keyRows) {
    const columns = keyByTable.get(row.tableName) || new Map();
    columns.set(row.columnName, row);
    keyByTable.set(row.tableName, columns);
  }
  let invalidKeys = false;
  for (const table of autoIncrementTables) {
    const id = keyByTable.get(table)?.get('id');
    const valid = id?.columnKey === 'PRI'
      && id.columnType === 'int unsigned'
      && id.extra.toLowerCase().includes('auto_increment');
    console.log(`${valid ? 'OK' : 'CHECK'} ${table}.id ${valid ? '(INT UNSIGNED AUTO_INCREMENT primary key)' : '(expected INT UNSIGNED AUTO_INCREMENT primary key)'}`);
    if (!valid) invalidKeys = true;
  }
  const bookingKeys = keyByTable.get('booking_services');
  const validBookingKeys = bookingKeys?.get('booking_id')?.columnKey === 'PRI'
    && bookingKeys?.get('booking_id')?.columnType === 'int unsigned'
    && bookingKeys?.get('service_id')?.columnKey === 'PRI'
    && bookingKeys?.get('service_id')?.columnType === 'int unsigned';
  console.log(`${validBookingKeys ? 'OK' : 'CHECK'} booking_services (composite primary key: booking_id + service_id)`);
  if (!validBookingKeys) invalidKeys = true;

  const settingKey = keyByTable.get('app_settings')?.get('setting_key');
  const validSettingKey = settingKey?.columnKey === 'PRI';
  console.log(`${validSettingKey ? 'OK' : 'CHECK'} app_settings.setting_key (primary key)`);
  if (!validSettingKey) invalidKeys = true;
  if (invalidKeys) {
    console.error('\nOne or more existing primary keys do not match the project schema. Back up the database before altering populated tables.');
    process.exitCode = 1;
    return;
  }
  console.log('\nDatabase connection and required tables are ready.');
}

main().catch(error => {
  console.error(`Database check failed: ${error.code || error.message}`);
  if (error.code === 'ER_ACCESS_DENIED_ERROR') console.error('Check DB_USER and DB_PASSWORD in BACKEND/.env.');
  if (error.code === 'ER_BAD_DB_ERROR') console.error('Check DB_NAME in BACKEND/.env and create/select that schema in MySQL.');
  process.exitCode = 1;
}).finally(() => pool.end());
