const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function main() {
  const sql = await fs.readFile(path.resolve(__dirname, '../database/setup_full.sql'), 'utf8');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'bicycle_app',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${String(process.env.DB_NAME || 'bicycle_mechanic').replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${String(process.env.DB_NAME || 'bicycle_mechanic').replace(/`/g, '')}\``);
    const [tables] = await connection.execute(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_NAME = ?',
      ['booking_services'],
    );
    if (tables.length) {
      const [columns] = await connection.execute(
        'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND TABLE_NAME = ?',
        ['booking_services'],
      );
      const existingColumns = new Set(columns.map(row => row.COLUMN_NAME));
      const additions = [
        ['service_name_snapshot', "VARCHAR(120) NOT NULL DEFAULT ''"],
        ['unit_price_snapshot', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
        ['duration_snapshot', 'SMALLINT UNSIGNED NOT NULL DEFAULT 60'],
      ];
      for (const [name, definition] of additions) {
        if (!existingColumns.has(name)) {
          await connection.query(`ALTER TABLE booking_services ADD COLUMN \`${name}\` ${definition}`);
        }
      }
    }
    await connection.query(sql);
    const [bookingColumns] = await connection.execute(
      'SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND TABLE_NAME = ?',
      ['bookings'],
    );
    const bookingColumnByName = new Map(bookingColumns.map(row => [row.COLUMN_NAME, row.COLUMN_TYPE]));
    if (!bookingColumnByName.has('bicycle_id')) {
      await connection.query('ALTER TABLE bookings ADD COLUMN bicycle_id INT UNSIGNED NULL AFTER customer_id');
    }
    if (!bookingColumnByName.has('booking_group_id')) {
      await connection.query('ALTER TABLE bookings ADD COLUMN booking_group_id INT UNSIGNED NULL AFTER customer_id');
    }
    const [paymentTransactionColumns] = await connection.execute(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND TABLE_NAME = ?',
      ['payment_transactions'],
    );
    if (paymentTransactionColumns.length && !paymentTransactionColumns.some(row => row.COLUMN_NAME === 'booking_group_payment_id')) {
      await connection.query('ALTER TABLE payment_transactions ADD COLUMN booking_group_payment_id INT UNSIGNED NULL AFTER payment_id');
    }
    const [bicycleIndex] = await connection.execute(
      `SELECT INDEX_NAME FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_bicycle'`,
    );
    if (!bicycleIndex.length) await connection.query('ALTER TABLE bookings ADD KEY idx_bookings_bicycle (bicycle_id)');
    const bookingStatuses = "'pending_review','confirmed','awaiting_customer','rescheduled','awaiting_customer_response','awaiting_payment','payment_submitted','payment_rejected','in_progress','completed','rejected','cancelled','no_show'";
    const requiredStatuses = ['pending_review', 'confirmed', 'awaiting_customer', 'rescheduled', 'awaiting_customer_response', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'in_progress', 'completed', 'rejected', 'cancelled', 'no_show'];
    if (bookingColumnByName.has('status') && requiredStatuses.some(status => !bookingColumnByName.get('status').includes(status))) {
      await connection.query(`ALTER TABLE bookings MODIFY status ENUM(${bookingStatuses}) NOT NULL DEFAULT 'pending_review'`);
    }
    const [bicycleForeignKey] = await connection.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'bicycle_id'
       AND REFERENCED_TABLE_NAME = 'bicycles'`,
    );
    if (!bicycleForeignKey.length) {
      await connection.query('ALTER TABLE bookings ADD CONSTRAINT fk_bookings_bicycle FOREIGN KEY (bicycle_id) REFERENCES bicycles(id) ON DELETE SET NULL');
    }
    const [groupForeignKey] = await connection.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'booking_group_id'
       AND REFERENCED_TABLE_NAME = 'booking_groups'`,
    );
    if (!groupForeignKey.length) {
      await connection.query('ALTER TABLE bookings ADD CONSTRAINT fk_bookings_group FOREIGN KEY (booking_group_id) REFERENCES booking_groups(id) ON DELETE SET NULL');
    }
    const [groupPaymentForeignKey] = await connection.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND TABLE_NAME = 'payment_transactions' AND COLUMN_NAME = 'booking_group_payment_id'
       AND REFERENCED_TABLE_NAME = 'booking_group_payments'`,
    );
    if (paymentTransactionColumns.length && !groupPaymentForeignKey.length) {
      await connection.query('ALTER TABLE payment_transactions ADD CONSTRAINT fk_payment_transaction_group_payment FOREIGN KEY (booking_group_payment_id) REFERENCES booking_group_payments(id) ON DELETE RESTRICT');
    }
    if (!bookingColumnByName.has('reservation_expires_at')) {
      await connection.query('ALTER TABLE bookings ADD COLUMN reservation_expires_at DATETIME NULL AFTER admin_note');
    }
    const [scheduleColumns] = await connection.execute(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND TABLE_NAME = ?',
      ['availability_schedules'],
    );
    if (!scheduleColumns.some(row => row.COLUMN_NAME === 'daily_capacity_minutes')) {
      await connection.query('ALTER TABLE availability_schedules ADD COLUMN daily_capacity_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 600 AFTER slot_minutes');
    }
    if (!scheduleColumns.some(row => row.COLUMN_NAME === 'max_dropoffs_per_slot')) {
      await connection.query('ALTER TABLE availability_schedules ADD COLUMN max_dropoffs_per_slot SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER daily_capacity_minutes');
    }
    const [paymentColumns] = await connection.execute(
      'SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['payments', 'status'],
    );
    if (paymentColumns.length && !paymentColumns[0].COLUMN_TYPE.includes('expired')) {
      await connection.query("ALTER TABLE payments MODIFY status ENUM('pending','partially_paid','paid','refunded','expired') NOT NULL DEFAULT 'pending'");
    }
    await connection.query(
      `UPDATE booking_services bs JOIN services s ON s.id = bs.service_id
       SET bs.service_name_snapshot = s.name,
           bs.unit_price_snapshot = s.starting_price,
           bs.duration_snapshot = s.estimated_minutes
       WHERE bs.service_name_snapshot = ''`,
    );
    console.log(`Database schema is ready in ${process.env.DB_NAME || 'bicycle_mechanic'}.`);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`Database setup failed: ${error.code || 'DATABASE_ERROR'}: ${error.message}`);
  process.exitCode = 1;
});
