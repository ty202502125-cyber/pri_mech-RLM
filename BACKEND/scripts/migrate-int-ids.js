const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const pool = require('../src/config/db');

const entityTables = [
  'users', 'services', 'bookings', 'mechanic_builds', 'mechanic_certifications',
  'announcements', 'work_sessions', 'password_reset_tokens', 'customer_reviews',
];
const idColumns = [
  ...entityTables.map(table => [table, 'id']),
  ['bookings', 'customer_id'], ['bookings', 'service_id'],
  ['booking_services', 'booking_id'], ['booking_services', 'service_id'],
  ['password_reset_tokens', 'user_id'],
  ['customer_reviews', 'booking_id'], ['customer_reviews', 'customer_id'],
];
const expectedForeignKeys = [
  'fk_bookings_customer', 'fk_bookings_service',
  'fk_booking_services_booking', 'fk_booking_services_service',
  'fk_password_reset_user', 'fk_review_booking', 'fk_review_customer',
];
const intUnsignedMax = 4294967295;

async function main() {
  if ((process.env.DB_NAME || 'bicycle_mechanic') !== 'bicycle_mechanic') {
    throw new Error('This migration targets bicycle_mechanic. Set DB_NAME=bicycle_mechanic before running it.');
  }

  const [columns] = await pool.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType
     FROM information_schema.columns WHERE table_schema = DATABASE()`,
  );
  const typeByColumn = new Map(columns.map(col => [`${col.tableName}.${col.columnName}`, col.columnType]));
  for (const [table, column] of idColumns) {
    const type = typeByColumn.get(`${table}.${column}`);
    if (!type) throw new Error(`Required column ${table}.${column} is missing; run npm run db:setup first.`);
    if (!['bigint unsigned', 'int unsigned'].includes(type)) {
      throw new Error(`${table}.${column} has type ${type}; expected BIGINT UNSIGNED or INT UNSIGNED.`);
    }
  }
  if (idColumns.every(([table, column]) => typeByColumn.get(`${table}.${column}`) === 'int unsigned')) {
    console.log('All record IDs and linked ID columns are already INT UNSIGNED. No migration needed.');
    return;
  }

  for (const table of entityTables) {
    const [[row]] = await pool.query(`SELECT COALESCE(MAX(id), 0) AS maxId FROM \`${table}\``);
    if (Number(row.maxId) > intUnsignedMax) {
      throw new Error(`${table}.id exceeds INT UNSIGNED capacity (${intUnsignedMax}); migration stopped without changes.`);
    }
  }

  const [constraints] = await pool.execute(
    'SELECT CONSTRAINT_NAME AS constraintName FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()',
  );
  const availableKeys = new Set(constraints.map(row => row.constraintName));
  const missingKeys = expectedForeignKeys.filter(name => !availableKeys.has(name));
  if (missingKeys.length) {
    throw new Error(`Expected foreign keys were not found (${missingKeys.join(', ')}). No changes made; inspect your schema first.`);
  }

  const sql = await fs.readFile(path.resolve(__dirname, '../database/migrations/006_int_unsigned_ids.sql'), 'utf8');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'bicycle_app',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  try {
    await connection.query(sql);
    console.log('Converted record IDs and matching foreign-key columns to INT UNSIGNED. Existing ID values were preserved.');
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`ID migration failed: ${error.code || error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());
