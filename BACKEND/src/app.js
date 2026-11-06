const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./config/db');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { notify, recordTransition } = require('./services/booking-workflow');
const {
  mysqlDateTime,
  dateAtWorkshopTime,
  capacityForDate,
  slotCheck,
  serviceDuration,
} = require('./services/availability');
const { privateProofDirectory, parseProofDataUrl, saveProof, updatePaymentSummary } = require('./services/payments');
const {
  privateBicyclePhotoDirectory,
  parseBicyclePhotoDataUrl,
  saveBicyclePhoto,
} = require('./services/bicycle-photos');

const app = express();
const requiredTables = [
  'users', 'services', 'bookings', 'booking_services', 'mechanic_builds',
  'mechanic_certifications', 'announcements', 'work_sessions', 'app_settings',
  'password_reset_tokens', 'customer_reviews', 'customer_profiles', 'bicycles',
  'availability_schedules', 'unavailable_dates', 'booking_status_history',
  'booking_reschedules', 'repair_records', 'repair_parts', 'payments',
  'repair_status_history', 'payment_transactions', 'notifications', 'maintenance_reminders', 'audit_logs',
  'booking_groups', 'booking_group_payments', 'booking_photos',
];
const allowedOrigins = [process.env.FRONTEND_ORIGIN || 'http://localhost:5173', 'http://127.0.0.1:5173'];
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '14mb' }));
app.use(cookieParser());
const uploadDirectory = path.resolve(__dirname, '../uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
app.use('/uploads', express.static(uploadDirectory, { dotfiles: 'deny', maxAge: '1d' }));
app.use((request, response, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {
    return response.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
});
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    const [rows] = await pool.execute(
      'SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    const existing = new Set(rows.map(row => row.tableName));
    const missingTables = requiredTables.filter(table => !existing.has(table));
    const [columnRows] = await pool.execute(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND ((TABLE_NAME = 'bookings' AND COLUMN_NAME IN ('reservation_expires_at', 'booking_group_id'))
           OR (TABLE_NAME = 'availability_schedules' AND COLUMN_NAME IN ('daily_capacity_minutes', 'max_dropoffs_per_slot')))`,
    );
    const existingColumns = new Set(columnRows.map(row => `${row.tableName}.${row.columnName}`));
    const requiredColumns = [
      'bookings.reservation_expires_at',
      'bookings.booking_group_id',
      'availability_schedules.daily_capacity_minutes',
      'availability_schedules.max_dropoffs_per_slot',
    ];
    const missingColumns = requiredColumns.filter(column => !existingColumns.has(column));
    if (missingTables.length) {
      return response.status(503).json({ status: 'error', service: 'bicycle-mechanic-api', database: 'schema_incomplete', missingTables });
    }
    if (missingColumns.length) {
      return response.status(503).json({
        status: 'error',
        service: 'bicycle-mechanic-api',
        database: 'schema_incomplete',
        missingColumns,
        fix: 'Run npm run db:setup from BACKEND, then restart the API.',
      });
    }
    response.json({ status: 'ok', service: 'bicycle-mechanic-api', database: 'connected', schema: 'ready' });
  } catch {
    response.status(503).json({ status: 'error', service: 'bicycle-mechanic-api', database: 'unavailable' });
  }
});

app.get('/api/services', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, description, starting_price, estimated_minutes, requires_inspection FROM services WHERE is_active = 1 ORDER BY name',
    );
    response.json({ services: rows });
  } catch (error) { next(error); }
});

app.get('/api/booking-status', async (_request, response, next) => {
  try {
    const [[setting]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'booking_enabled'");
    response.json({ enabled: setting?.setting_value !== 'false' });
  } catch (error) { next(error); }
});

app.get('/api/availability/schedules', async (_request, response, next) => {
  try {
    const [schedules] = await pool.execute(
      'SELECT day_of_week, is_working_day, opens_at, closes_at, break_starts_at, break_ends_at, slot_minutes, daily_capacity_minutes, max_dropoffs_per_slot FROM availability_schedules ORDER BY day_of_week',
    );
    response.json({ schedules });
  } catch (error) { next(error); }
});

app.get('/api/availability', async (request, response, next) => {
  const date = String(request.query.date || '');
  const requestedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(requestedDate.getTime()) || requestedDate.toISOString().slice(0, 10) !== date) {
    return response.status(400).json({ error: 'Choose a valid date in YYYY-MM-DD format.' });
  }
  const rawIds = String(request.query.serviceIds || request.query.serviceId || '');
  const serviceIds = rawIds ? rawIds.split(',').map(Number) : [];
  if (serviceIds.length > 10 || serviceIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(serviceIds).size !== serviceIds.length) {
    return response.status(400).json({ error: 'Choose up to ten different active services.' });
  }
  try {
    const duration = await serviceDuration(pool, serviceIds);
    if (serviceIds.length && !duration) return response.status(400).json({ error: 'One or more selected services are unavailable.' });
    const capacity = await capacityForDate(pool, date);
    const schedule = capacity.schedule;
    if (capacity.status === 'closed' || capacity.status === 'unavailable') {
      return response.json({ ...capacity, durationMinutes: duration || null, slots: [], reason: capacity.status === 'closed' ? 'The workshop is not open on that day.' : 'The workshop is unavailable on that date.' });
    }
    const interval = Number(schedule.slot_minutes);
    const length = duration || interval;
    if (length > 1440) return response.status(400).json({ error: 'The combined service duration is too long for one booking.' });
    const toMinutes = value => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
    const openAt = toMinutes(schedule.opens_at);
    const closeAt = toMinutes(schedule.closes_at);
    const slots = [];
    for (let minute = openAt; minute < closeAt; minute += interval) {
      const startAt = dateAtWorkshopTime(date, minute);
      if (startAt <= new Date()) continue;
      const result = await slotCheck(pool, { startAt, durationMinutes: length });
      if (result.available) slots.push({ startsAt: startAt.toISOString(), durationMinutes: length });
    }
    response.json({ ...capacity, durationMinutes: length, slots });
  } catch (error) { next(error); }
});

app.put('/api/admin/availability/schedules/:dayOfWeek', requireAuth, requireAdmin, async (request, response, next) => {
  const day = Number(request.params.dayOfWeek);
  const isWorkingDay = request.body.isWorkingDay === true;
  const opensAt = request.body.opensAt || null;
  const closesAt = request.body.closesAt || null;
  const breakStartsAt = request.body.breakStartsAt || null;
  const breakEndsAt = request.body.breakEndsAt || null;
  const slotMinutes = Number(request.body.slotMinutes);
  const dailyCapacityMinutes = Number(request.body.dailyCapacityMinutes ?? 600);
  const maxDropoffsPerSlot = Number(request.body.maxDropoffsPerSlot ?? 1);
  const timeValid = value => value === null || (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value));
  const toMinutes = value => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : 0;
  const availableWorkMinutes = opensAt && closesAt
    ? toMinutes(closesAt) - toMinutes(opensAt) - (breakStartsAt && breakEndsAt ? toMinutes(breakEndsAt) - toMinutes(breakStartsAt) : 0)
    : 0;
  if (!Number.isInteger(day) || day < 0 || day > 6 || !Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 1440
      || !Number.isInteger(dailyCapacityMinutes) || dailyCapacityMinutes < 1 || dailyCapacityMinutes > 1440
      || !Number.isInteger(maxDropoffsPerSlot) || maxDropoffsPerSlot < 1 || maxDropoffsPerSlot > 100
      || ![opensAt, closesAt, breakStartsAt, breakEndsAt].every(timeValid)
      || (isWorkingDay && (!opensAt || !closesAt || opensAt >= closesAt))
      || Boolean(breakStartsAt) !== Boolean(breakEndsAt)
      || (breakStartsAt && (breakStartsAt >= breakEndsAt || breakStartsAt < opensAt || breakEndsAt > closesAt))
      || (isWorkingDay && dailyCapacityMinutes > availableWorkMinutes)) {
    return response.status(400).json({ error: 'Check the working hours, break, capacity, drop-off limit, and slot interval.' });
  }
  try {
    await pool.execute(
      `INSERT INTO availability_schedules (day_of_week, is_working_day, opens_at, closes_at, break_starts_at, break_ends_at, slot_minutes, daily_capacity_minutes, max_dropoffs_per_slot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_working_day = VALUES(is_working_day), opens_at = VALUES(opens_at),
       closes_at = VALUES(closes_at), break_starts_at = VALUES(break_starts_at), break_ends_at = VALUES(break_ends_at),
       slot_minutes = VALUES(slot_minutes), daily_capacity_minutes = VALUES(daily_capacity_minutes),
       max_dropoffs_per_slot = VALUES(max_dropoffs_per_slot)`,
      [day, isWorkingDay, opensAt, closesAt, breakStartsAt, breakEndsAt, slotMinutes, dailyCapacityMinutes, maxDropoffsPerSlot],
    );
    await pool.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [request.user.id, 'availability.schedule_updated', 'availability_schedule', String(day)],
    );
    response.json({ message: 'Weekly schedule saved.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/availability/unavailable-dates', requireAuth, requireAdmin, async (request, response, next) => {
  const startsAt = new Date(request.body.startsAt);
  const endsAt = new Date(request.body.endsAt);
  const reason = String(request.body.reason || '').trim().slice(0, 500) || null;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
    return response.status(400).json({ error: 'Choose a valid start and end time for the closure.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const weekdays = new Set();
    for (let cursor = Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate()); cursor < endsAt.getTime(); cursor += 86400000) {
      weekdays.add(new Date(cursor).getUTCDay());
    }
    for (const weekday of [...weekdays].sort()) {
      await connection.execute('SELECT id FROM availability_schedules WHERE day_of_week = ? FOR UPDATE', [weekday]);
    }
    const [result] = await connection.execute(
      'INSERT INTO unavailable_dates (starts_at, ends_at, reason, created_by) VALUES (?, ?, ?, ?)',
      [mysqlDateTime(startsAt), mysqlDateTime(endsAt), reason, request.user.id],
    );
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [request.user.id, 'availability.closure_created', 'unavailable_date', String(result.insertId), JSON.stringify({ startsAt: mysqlDateTime(startsAt), endsAt: mysqlDateTime(endsAt), reason })],
    );
    await connection.commit();
    response.status(201).json({ id: result.insertId, message: 'Unavailable time saved.' });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get('/api/admin/availability/unavailable-dates', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [dates] = await pool.execute('SELECT id, starts_at, ends_at, reason, created_at FROM unavailable_dates ORDER BY starts_at');
    response.json({ unavailableDates: dates });
  } catch (error) { next(error); }
});

app.delete('/api/admin/availability/unavailable-dates/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid unavailable date.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT starts_at, ends_at FROM unavailable_dates WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Unavailable date not found.' });
    }
    const start = new Date(rows[0].starts_at);
    const end = new Date(rows[0].ends_at);
    const weekdays = new Set();
    for (let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); cursor < end.getTime(); cursor += 86400000) {
      weekdays.add(new Date(cursor).getUTCDay());
    }
    for (const weekday of [...weekdays].sort()) {
      await connection.execute('SELECT id FROM availability_schedules WHERE day_of_week = ? FOR UPDATE', [weekday]);
    }
    await connection.execute('DELETE FROM unavailable_dates WHERE id = ?', [id]);
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [request.user.id, 'availability.closure_deleted', 'unavailable_date', String(id)],
    );
    await connection.commit();
    response.json({ message: 'Unavailable time removed.' });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get('/api/builds', async (_request, response, next) => {
  try {
    const [builds] = await pool.execute('SELECT id, title, image_url, owner_name, social_url FROM mechanic_builds ORDER BY created_at DESC');
    response.json({ builds });
  } catch (error) { next(error); }
});

app.get('/api/certifications', async (_request, response, next) => {
  try {
    const [certifications] = await pool.execute('SELECT id, body, title, year, image_url FROM mechanic_certifications ORDER BY created_at DESC');
    response.json({ certifications });
  } catch (error) { next(error); }
});

app.get('/api/reviews', async (_request, response, next) => {
  try {
    const [reviews] = await pool.execute(`SELECT r.id, r.rating, r.comment, r.is_anonymous, r.created_at,
      IF(r.is_anonymous = 1, 'Anonymous rider', u.full_name) AS display_name, s.name AS service_name
      FROM customer_reviews r JOIN users u ON u.id = r.customer_id
      JOIN bookings b ON b.id = r.booking_id JOIN services s ON s.id = b.service_id
      WHERE b.status = 'completed' ORDER BY r.created_at DESC LIMIT 50`);
    const [[summary]] = await pool.execute(`SELECT COUNT(*) AS count, COALESCE(AVG(r.rating), 0) AS average
      FROM customer_reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.status = 'completed'`);
    response.json({ reviews, summary });
  } catch (error) { next(error); }
});

app.get('/api/announcements', requireAuth, async (_request, response, next) => {
  try {
    const [announcements] = await pool.execute(
      'SELECT id, title, body, event_at, created_at FROM announcements WHERE is_published = 1 ORDER BY COALESCE(event_at, created_at) DESC LIMIT 50',
    );
    response.json({ announcements });
  } catch (error) { next(error); }
});

app.get('/api/notifications', requireAuth, async (request, response, next) => {
  try {
    const [notifications] = await pool.execute(
      'SELECT id, type, title, body, related_booking_id, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [request.user.id],
    );
    response.json({ notifications });
  } catch (error) { next(error); }
});

app.patch('/api/notifications/read-all', requireAuth, async (request, response, next) => {
  try {
    await pool.execute('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL', [request.user.id]);
    response.json({ message: 'Notifications marked as read.' });
  } catch (error) { next(error); }
});

app.patch('/api/notifications/:id/read', requireAuth, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid notification.' });
  try {
    const [result] = await pool.execute('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?', [id, request.user.id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Notification not found.' });
    response.json({ message: 'Notification marked as read.' });
  } catch (error) { next(error); }
});

app.get('/api/customers/me', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  try {
    const [[profile]] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, p.phone, p.address, p.profile_image_url
       FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id WHERE u.id = ?`,
      [request.user.id],
    );
    response.json({ profile });
  } catch (error) { next(error); }
});

app.put('/api/customers/me', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const fullName = String(request.body.fullName || '').trim();
  const phone = String(request.body.phone || '').trim() || null;
  const address = String(request.body.address || '').trim() || null;
  if (fullName.length < 2 || fullName.length > 120 || (phone && phone.length > 32) || (address && address.length > 500)) {
    return response.status(400).json({ error: 'Check the name, phone number, and address lengths.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET full_name = ? WHERE id = ?', [fullName, request.user.id]);
    await connection.execute(
      `INSERT INTO customer_profiles (user_id, phone, address) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE phone = VALUES(phone), address = VALUES(address)`,
      [request.user.id, phone, address],
    );
    await connection.commit();
    response.json({ profile: { id: request.user.id, full_name: fullName, email: request.user.email, phone, address } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get('/api/bicycles', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  try {
    const [bicycles] = await pool.execute(
      `SELECT id, brand, model, category, frame_details, description, created_at, updated_at
       FROM bicycles WHERE customer_id = ? AND is_active = 1 ORDER BY created_at DESC`,
      [request.user.id],
    );
    response.json({ bicycles });
  } catch (error) { next(error); }
});

app.post('/api/bicycles', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const brand = String(request.body.brand || '').trim() || null;
  const model = String(request.body.model || '').trim() || null;
  const category = String(request.body.category || '').trim();
  const frameDetails = String(request.body.frameDetails || '').trim() || null;
  const description = String(request.body.description || '').trim() || null;
  if (category.length < 2 || category.length > 80 || (brand && brand.length > 100) || (model && model.length > 100)
      || (frameDetails && frameDetails.length > 160) || (description && description.length > 1000)) {
    return response.status(400).json({ error: 'Check the bicycle category and field lengths.' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO bicycles (customer_id, brand, model, category, frame_details, description) VALUES (?, ?, ?, ?, ?, ?)',
      [request.user.id, brand, model, category, frameDetails, description],
    );
    response.status(201).json({ bicycle: { id: result.insertId, brand, model, category, frame_details: frameDetails, description } });
  } catch (error) { next(error); }
});

app.put('/api/bicycles/:id', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const id = Number(request.params.id);
  const brand = String(request.body.brand || '').trim() || null;
  const model = String(request.body.model || '').trim() || null;
  const category = String(request.body.category || '').trim();
  const frameDetails = String(request.body.frameDetails || '').trim() || null;
  const description = String(request.body.description || '').trim() || null;
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid bicycle.' });
  if (category.length < 2 || category.length > 80 || (brand && brand.length > 100) || (model && model.length > 100)
      || (frameDetails && frameDetails.length > 160) || (description && description.length > 1000)) {
    return response.status(400).json({ error: 'Check the bicycle category and field lengths.' });
  }
  try {
    const [result] = await pool.execute(
      `UPDATE bicycles SET brand = ?, model = ?, category = ?, frame_details = ?, description = ?
       WHERE id = ? AND customer_id = ? AND is_active = 1`,
      [brand, model, category, frameDetails, description, id, request.user.id],
    );
    if (!result.affectedRows) return response.status(404).json({ error: 'Bicycle not found.' });
    response.json({ message: 'Bicycle updated.' });
  } catch (error) { next(error); }
});

app.delete('/api/bicycles/:id', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid bicycle.' });
  try {
    const [result] = await pool.execute('UPDATE bicycles SET is_active = 0 WHERE id = ? AND customer_id = ? AND is_active = 1', [id, request.user.id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Bicycle not found.' });
    response.json({ message: 'Bicycle removed from your active list.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/register', async (request, response, next) => {
  try {
    const fullName = String(request.body.fullName || '').trim();
    const email = String(request.body.email || '').trim().toLowerCase();
    const password = String(request.body.password || '');
    if (fullName.length < 2 || fullName.length > 120) return response.status(400).json({ error: 'Enter your name (2 to 120 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return response.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) return response.status(400).json({ error: 'Password must be at least 10 characters and no more than 72 UTF-8 bytes.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, \'customer\')',
      [fullName, email, passwordHash],
    );
    response.status(201).json({ user: { id: result.insertId, fullName, email, role: 'customer' } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'An account with this email already exists.' });
    next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase();
    const password = String(request.body.password || '');
    if (!email || email.length > 254 || !password || Buffer.byteLength(password, 'utf8') > 72) {
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, password_hash, role FROM users WHERE email = ? AND is_active = 1',
      [email],
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const user = rows[0];
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '8h' });
    response.cookie('session', token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
    response.json({ user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

app.post('/api/auth/forgot-password', async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Enter a valid email address.' });
    const [users] = await pool.execute('SELECT id FROM users WHERE email = ? AND is_active = 1', [email]);
    const result = { message: 'If an active account uses that email, a password reset link has been created.' };
    if (users.length) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [users[0].id]);
      await pool.execute(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))',
        [users[0].id, tokenHash],
      );
      if (process.env.NODE_ENV !== 'production') result.resetUrl = `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
      else console.warn('Password reset requested but no mail delivery integration is configured. Configure an email provider before production use.');
    }
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/api/auth/reset-password', async (request, response, next) => {
  const token = String(request.body.token || '');
  const password = String(request.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.status(400).json({ error: 'Reset link is invalid or expired.' });
  if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) return response.status(400).json({ error: 'Password must be at least 10 characters and no more than 72 UTF-8 bytes.' });
  try {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE',
        [hash],
      );
      if (!rows.length) {
        await connection.rollback();
        return response.status(400).json({ error: 'Reset link is invalid or expired. Request a new one.' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].user_id]);
      await connection.execute('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [rows[0].user_id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    response.json({ message: 'Password changed. You can sign in with your new password.' });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', requireAuth, (request, response) => response.json({ user: request.user }));
app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie('session', cookieOptions);
  response.status(204).end();
});

app.get('/api/bookings/mine', requireAuth, async (request, response, next) => {
  try {
    if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
    const [rows] = await pool.execute(
      `SELECT b.id, b.booking_ref, b.bicycle_type, b.bicycle_brand, b.bicycle_model,
        b.problem_description, b.preferred_at, b.scheduled_at, b.status, b.admin_note, b.reservation_expires_at, b.created_at,
        p.status AS payment_status, p.estimated_amount, p.final_amount,
        COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt
          WHERE pt.payment_id = p.id AND pt.status = 'verified'), 0) AS verified_amount,
        bg.id AS booking_group_id, bg.group_ref, bg.payment_choice,
        (SELECT COUNT(*) FROM booking_photos bp WHERE bp.booking_id = b.id) AS photo_count,
        (SELECT status FROM booking_group_payments bgp
          WHERE bgp.group_id = bg.id ORDER BY bgp.created_at DESC LIMIT 1) AS group_payment_status,
        (SELECT id FROM booking_group_payments bgp
          WHERE bgp.group_id = bg.id ORDER BY bgp.created_at DESC LIMIT 1) AS group_payment_id,
        (SELECT admin_note FROM booking_group_payments bgp
          WHERE bgp.group_id = bg.id ORDER BY bgp.created_at DESC LIMIT 1) AS group_payment_note,
        r.id AS review_id, r.rating AS review_rating, r.comment AS review_comment, r.is_anonymous AS review_is_anonymous,
        COALESCE((SELECT GROUP_CONCAT(selected_service.name ORDER BY selected_service.name SEPARATOR ', ')
          FROM booking_services bs JOIN services selected_service ON selected_service.id = bs.service_id
          WHERE bs.booking_id = b.id), s.name) AS service_name
       FROM bookings b JOIN services s ON s.id = b.service_id
       LEFT JOIN booking_groups bg ON bg.id = b.booking_group_id
       LEFT JOIN payments p ON p.booking_id = b.id
       LEFT JOIN customer_reviews r ON r.booking_id = b.id
       WHERE b.customer_id = ? ORDER BY b.created_at DESC`,
      [request.user.id],
    );
    response.json({ bookings: rows });
  } catch (error) { next(error); }
});

app.get('/api/bookings/:id/photos', requireAuth, async (request, response, next) => {
  const bookingId = Number(request.params.id);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1) return response.status(400).json({ error: 'Invalid booking.' });
  try {
    const [bookings] = await pool.execute('SELECT customer_id FROM bookings WHERE id = ?', [bookingId]);
    if (!bookings.length || (request.user.role !== 'admin' && bookings[0].customer_id !== request.user.id)) {
      return response.status(404).json({ error: 'Booking photos not found.' });
    }
    const [photos] = await pool.execute(
      'SELECT id, content_type, file_size, created_at FROM booking_photos WHERE booking_id = ? ORDER BY created_at',
      [bookingId],
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.json({ photos });
  } catch (error) { next(error); }
});

app.post('/api/bookings/:id/photos', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const bookingId = Number(request.params.id);
  const photo = parseBicyclePhotoDataUrl(request.body.photoData);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1 || !photo) {
    return response.status(400).json({ error: 'Upload a valid JPEG, PNG, or WebP bicycle photo no larger than 10 MB.' });
  }
  let savedFile;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [bookings] = await connection.execute(
      `SELECT id FROM bookings WHERE id = ? AND customer_id = ?
       AND status = 'pending_review' FOR UPDATE`,
      [bookingId, request.user.id],
    );
    if (!bookings.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'An editable booking request was not found.' });
    }
    const [[count]] = await connection.execute('SELECT COUNT(*) AS count FROM booking_photos WHERE booking_id = ?', [bookingId]);
    if (Number(count.count) >= 3) {
      await connection.rollback();
      return response.status(409).json({ error: 'A bicycle can have up to three photos.' });
    }
    savedFile = await saveBicyclePhoto(photo);
    const [result] = await connection.execute(
      'INSERT INTO booking_photos (booking_id, file_name, content_type, file_size) VALUES (?, ?, ?, ?)',
      [bookingId, savedFile.filename, photo.contentType, photo.buffer.length],
    );
    await connection.commit();
    response.status(201).json({ photo: { id: result.insertId }, message: 'Bicycle photo uploaded.' });
  } catch (error) {
    await connection.rollback();
    if (savedFile) await fs.promises.unlink(savedFile.fullPath).catch(() => {});
    next(error);
  } finally { connection.release(); }
});

app.get('/api/booking-photos/:id', requireAuth, async (request, response, next) => {
  const photoId = Number(request.params.id);
  if (!Number.isSafeInteger(photoId) || photoId < 1) return response.status(400).json({ error: 'Invalid photo.' });
  try {
    const [rows] = await pool.execute(
      `SELECT bp.file_name, bp.content_type, b.customer_id
       FROM booking_photos bp JOIN bookings b ON b.id = bp.booking_id WHERE bp.id = ?`,
      [photoId],
    );
    if (!rows.length || (request.user.role !== 'admin' && rows[0].customer_id !== request.user.id)) {
      return response.status(404).json({ error: 'Bicycle photo not found.' });
    }
    const fileName = path.basename(rows[0].file_name);
    response.setHeader('Content-Type', rows[0].content_type);
    response.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(path.join(privateBicyclePhotoDirectory, fileName)).on('error', next).pipe(response);
  } catch (error) { next(error); }
});

app.get('/api/bookings/:id/location', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid booking.' });
  try {
    const [bookings] = await pool.execute(
      `SELECT b.status, p.status AS payment_status
       FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.id = ? AND b.customer_id = ?`,
      [id, request.user.id],
    );
    if (!bookings.length) return response.status(404).json({ error: 'Booking not found.' });
    const booking = bookings[0];
    if (booking.payment_status !== 'paid' || !['confirmed', 'in_progress', 'completed'].includes(booking.status)) {
      return response.status(403).json({ error: 'The workshop address is available after the mechanic verifies full payment.' });
    }
    const [[setting]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'workshop_address'");
    if (!setting?.setting_value) return response.status(503).json({ error: 'The workshop address has not been configured yet.' });
    response.setHeader('Cache-Control', 'private, no-store');
    response.json({ address: setting.setting_value });
  } catch (error) { next(error); }
});

app.post('/api/bookings/:id/review', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const id = Number(request.params.id);
  const rating = Number(request.body.rating);
  const comment = String(request.body.comment || '').trim();
  const isAnonymous = request.body.anonymous === true;
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid booking.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response.status(400).json({ error: 'Choose a star rating from 1 to 5.' });
  if (comment.length < 3 || comment.length > 1500) return response.status(400).json({ error: 'Write a comment between 3 and 1,500 characters.' });
  try {
    const [bookings] = await pool.execute("SELECT id FROM bookings WHERE id = ? AND customer_id = ? AND status = 'completed'", [id, request.user.id]);
    if (!bookings.length) return response.status(409).json({ error: 'Reviews are available after the mechanic marks your booking complete.' });
    await pool.execute('INSERT INTO customer_reviews (booking_id, customer_id, rating, comment, is_anonymous) VALUES (?, ?, ?, ?, ?)', [id, request.user.id, rating, comment, isAnonymous]);
    response.status(201).json({ message: 'Thanks for sharing feedback about your completed service.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'You already reviewed this completed service.' });
    next(error);
  }
});

app.post('/api/booking-groups', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const bikes = request.body.bikes;
  const paymentChoice = String(request.body.paymentChoice || '');
  const supportedBikeTypes = ['Road bike', 'Mountain bike', 'Gravel bike', 'City / commuter bike'];
  if (!Array.isArray(bikes) || bikes.length < 1 || bikes.length > 10
      || !['together', 'separate'].includes(paymentChoice)) {
    return response.status(400).json({ error: 'Add one to ten bicycles and choose how you want to pay.' });
  }
  const registeredBicycleIds = bikes
    .map(bike => bike.bicycleId === undefined || bike.bicycleId === '' || bike.bicycleId === null ? null : Number(bike.bicycleId))
    .filter(id => id !== null);
  if (new Set(registeredBicycleIds).size !== registeredBicycleIds.length) {
    return response.status(400).json({ error: 'A registered bicycle can only be included once in a booking group.' });
  }
  try {
    const [[bookingSetting]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'booking_enabled'");
    if (bookingSetting?.setting_value === 'false') {
      return response.status(503).json({ error: 'Online bookings are temporarily paused. Please check the latest workshop announcement.' });
    }

    const preparedBikes = [];
    for (const bike of bikes) {
      const serviceIds = Array.isArray(bike.serviceIds) ? bike.serviceIds.map(Number) : [];
      const bicycleId = bike.bicycleId === undefined || bike.bicycleId === '' || bike.bicycleId === null ? null : Number(bike.bicycleId);
      let bicycleType = String(bike.bicycleType || '').trim();
      let brand = String(bike.brand || '').trim().slice(0, 100) || null;
      let model = String(bike.model || '').trim().slice(0, 100) || null;
      const problem = String(bike.problem || '').trim();
      const preferredAt = new Date(bike.preferredAt);
      if (!serviceIds.length || serviceIds.length > 10
          || serviceIds.some(id => !Number.isSafeInteger(id) || id < 1)
          || new Set(serviceIds).size !== serviceIds.length) {
        return response.status(400).json({ error: 'Choose between one and ten different services for every bicycle.' });
      }
      if (problem.length < 8 || problem.length > 2000) return response.status(400).json({ error: 'Describe each bicycle issue in 8 to 2,000 characters.' });
      if (Number.isNaN(preferredAt.getTime()) || preferredAt <= new Date()) return response.status(400).json({ error: 'Choose a future drop-off time for every bicycle.' });
      if (bicycleId !== null) {
        if (!Number.isSafeInteger(bicycleId) || bicycleId < 1) return response.status(400).json({ error: 'Choose a valid registered bicycle.' });
        const [[bicycle]] = await pool.execute(
          'SELECT brand, model, category FROM bicycles WHERE id = ? AND customer_id = ? AND is_active = 1',
          [bicycleId, request.user.id],
        );
        if (!bicycle) return response.status(404).json({ error: 'One selected bicycle was not found in your account.' });
        bicycleType = bicycle.category;
        brand = bicycle.brand;
        model = bicycle.model;
      }
      if (!supportedBikeTypes.includes(bicycleType)) return response.status(400).json({ error: 'Choose a supported bicycle category for every bicycle.' });
      const [services] = await pool.execute(
        `SELECT id, name, starting_price, estimated_minutes FROM services
         WHERE id IN (${serviceIds.map(() => '?').join(', ')}) AND is_active = 1`,
        serviceIds,
      );
      if (services.length !== serviceIds.length) return response.status(400).json({ error: 'One or more selected services are not currently available.' });
      const durationMinutes = services.reduce((total, service) => total + Number(service.estimated_minutes), 0);
      if (durationMinutes > 1440) return response.status(400).json({ error: 'The combined service duration is too long for one bicycle.' });
      const availability = await slotCheck(pool, { startAt: preferredAt, durationMinutes });
      if (!availability.available) return response.status(409).json({ error: availability.reason });
      preparedBikes.push({
        bicycleId, bicycleType, brand, model, problem, preferredAt, serviceIds,
        services: new Map(services.map(service => [Number(service.id), service])),
      });
    }

    const groupRef = `BG-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const connection = await pool.getConnection();
    const createdBookings = [];
    let groupId;
    try {
      await connection.beginTransaction();
      const [groupResult] = await connection.execute(
        'INSERT INTO booking_groups (group_ref, customer_id, payment_choice) VALUES (?, ?, ?)',
        [groupRef, request.user.id, paymentChoice],
      );
      groupId = groupResult.insertId;
      for (const bike of preparedBikes) {
        const bookingRef = `BM-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        const [bookingResult] = await connection.execute(
          `INSERT INTO bookings (booking_ref, customer_id, booking_group_id, bicycle_id, service_id,
           bicycle_type, bicycle_brand, bicycle_model, problem_description, preferred_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
          [bookingRef, request.user.id, groupResult.insertId, bike.bicycleId, bike.serviceIds[0],
            bike.bicycleType, bike.brand, bike.model, bike.problem,
            bike.preferredAt.toISOString().slice(0, 19).replace('T', ' ')],
        );
        const bookingServiceRows = bike.serviceIds.map(serviceId => {
          const service = bike.services.get(serviceId);
          return [bookingResult.insertId, serviceId, service.name, service.starting_price, service.estimated_minutes];
        });
        await connection.query(
          `INSERT INTO booking_services
           (booking_id, service_id, service_name_snapshot, unit_price_snapshot, duration_snapshot) VALUES ?`,
          [bookingServiceRows],
        );
        await connection.execute(
          'INSERT INTO booking_status_history (booking_id, previous_status, new_status, note, changed_by) VALUES (?, NULL, ?, ?, ?)',
          [bookingResult.insertId, 'pending_review', 'Customer submitted a grouped booking request.', request.user.id],
        );
        createdBookings.push({ id: bookingResult.insertId, bookingRef, status: 'pending_review' });
      }
      const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
      for (const admin of admins) {
        await notify(connection, admin.id, 'new_booking', 'New multi-bicycle booking request', `A customer submitted request ${groupRef} for ${createdBookings.length} bicycles.`, createdBookings[0].id);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    response.status(201).json({ group: { id: groupId, groupRef, paymentChoice }, bookings: createdBookings });
  } catch (error) { next(error); }
});

app.post('/api/bookings', requireAuth, async (request, response, next) => {
  try {
    const [[bookingSetting]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'booking_enabled'");
    if (bookingSetting?.setting_value === 'false') return response.status(503).json({ error: 'Online bookings are temporarily paused. Please check the latest workshop announcement.' });
    if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
    const serviceIds = (Array.isArray(request.body.serviceIds) ? request.body.serviceIds : [request.body.serviceId]).map(Number);
    const bicycleId = request.body.bicycleId === undefined || request.body.bicycleId === '' ? null : Number(request.body.bicycleId);
    let bicycleType = String(request.body.bicycleType || '').trim();
    const supportedBikeTypes = ['Road bike', 'Mountain bike', 'Gravel bike', 'City / commuter bike'];
    const problem = String(request.body.problem || '').trim();
    const preferredAt = new Date(request.body.preferredAt);
    let brand = String(request.body.brand || '').trim().slice(0, 100) || null;
    let model = String(request.body.model || '').trim().slice(0, 100) || null;
    if (bicycleId !== null) {
      if (!Number.isSafeInteger(bicycleId) || bicycleId < 1) return response.status(400).json({ error: 'Choose a valid registered bicycle.' });
      const [[bicycle]] = await pool.execute(
        'SELECT brand, model, category FROM bicycles WHERE id = ? AND customer_id = ? AND is_active = 1',
        [bicycleId, request.user.id],
      );
      if (!bicycle) return response.status(404).json({ error: 'The selected bicycle was not found in your account.' });
      bicycleType = bicycle.category;
      brand = bicycle.brand;
      model = bicycle.model;
    }
    if (!serviceIds.length || serviceIds.length > 10 || serviceIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(serviceIds).size !== serviceIds.length) return response.status(400).json({ error: 'Choose between one and ten different services.' });
      if (!supportedBikeTypes.includes(bicycleType) && bicycleId === null) return response.status(400).json({ error: 'Choose one of the supported bicycle categories.' });
    if (problem.length < 8 || problem.length > 2000) return response.status(400).json({ error: 'Describe the issue (8 to 2,000 characters).' });
    if (Number.isNaN(preferredAt.getTime()) || preferredAt <= new Date()) return response.status(400).json({ error: 'Choose a future preferred appointment time.' });
    const [services] = await pool.execute(
      `SELECT id, name, starting_price, estimated_minutes FROM services WHERE id IN (${serviceIds.map(() => '?').join(', ')}) AND is_active = 1`,
      serviceIds,
    );
    if (services.length !== serviceIds.length) return response.status(400).json({ error: 'One or more selected services are not currently available.' });
    const durationMinutes = services.reduce((total, service) => total + Number(service.estimated_minutes), 0);
    if (durationMinutes > 1440) return response.status(400).json({ error: 'The combined service duration is too long for one booking.' });
    const availability = await slotCheck(pool, { startAt: preferredAt, durationMinutes });
    if (!availability.available) return response.status(409).json({ error: availability.reason });
    const bookingRef = `BM-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const connection = await pool.getConnection();
    let result;
    try {
      await connection.beginTransaction();
      [result] = await connection.execute(
        `INSERT INTO bookings (booking_ref, customer_id, bicycle_id, service_id, bicycle_type, bicycle_brand,
         bicycle_model, problem_description, preferred_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
        [bookingRef, request.user.id, bicycleId, serviceIds[0], bicycleType, brand, model, problem, preferredAt.toISOString().slice(0, 19).replace('T', ' ')],
      );
      const selected = new Map(services.map(service => [Number(service.id), service]));
      const bookingServiceRows = serviceIds.map(serviceId => {
        const service = selected.get(serviceId);
        return [result.insertId, serviceId, service.name, service.starting_price, service.estimated_minutes];
      });
      await connection.query(
        'INSERT INTO booking_services (booking_id, service_id, service_name_snapshot, unit_price_snapshot, duration_snapshot) VALUES ?',
        [bookingServiceRows],
      );
      await connection.execute(
        'INSERT INTO booking_status_history (booking_id, previous_status, new_status, note, changed_by) VALUES (?, NULL, ?, ?, ?)',
        [result.insertId, 'pending_review', 'Customer submitted a booking request.', request.user.id],
      );
      const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
      for (const admin of admins) {
        await notify(connection, admin.id, 'new_booking', 'New booking request', `A customer submitted booking ${bookingRef}.`, result.insertId);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    response.status(201).json({ booking: { id: result.insertId, bookingRef, status: 'pending_review' } });
  } catch (error) { next(error); }
});

app.patch('/api/bookings/:id/cancel', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid booking.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT status FROM bookings WHERE id = ? AND customer_id = ? FOR UPDATE', [id, request.user.id]);
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Booking not found.' });
    }
    const previousStatus = rows[0].status;
    await recordTransition(connection, { bookingId: id, from: previousStatus, to: 'cancelled', actorId: request.user.id, actorRole: 'customer' });
    await connection.execute("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [id]);
    await connection.commit();
    response.json({ message: 'Booking cancelled.' });
  } catch (error) {
    await connection.rollback();
    if (error.statusCode) return response.status(error.statusCode).json({ error: error.message });
    next(error);
  } finally { connection.release(); }
});

app.get('/api/customers/me/repairs', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  try {
    const [repairs] = await pool.execute(
      `SELECT r.id, r.booking_id, r.status, r.inspection_notes, r.estimate_amount, r.estimate_status,
        r.final_amount, r.completion_notes, r.warranty_until, r.updated_at, b.booking_ref,
        b.bicycle_type, b.bicycle_brand, b.bicycle_model
       FROM repair_records r JOIN bookings b ON b.id = r.booking_id
       WHERE b.customer_id = ? ORDER BY r.updated_at DESC`,
      [request.user.id],
    );
    response.json({ repairs });
  } catch (error) { next(error); }
});

app.get('/api/repairs/:bookingId', requireAuth, async (request, response, next) => {
  const bookingId = Number(request.params.bookingId);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1) return response.status(400).json({ error: 'Invalid booking.' });
  try {
    const [rows] = await pool.execute(
      `SELECT r.*, b.customer_id, b.booking_ref FROM repair_records r
       JOIN bookings b ON b.id = r.booking_id WHERE r.booking_id = ?`,
      [bookingId],
    );
    if (!rows.length) return response.status(404).json({ error: 'Repair record not found.' });
    if (request.user.role !== 'admin' && rows[0].customer_id !== request.user.id) return response.status(404).json({ error: 'Repair record not found.' });
    const [parts] = await pool.execute('SELECT id, part_name, quantity, unit_cost, notes, created_at FROM repair_parts WHERE repair_id = ? ORDER BY id', [rows[0].id]);
    const [history] = await pool.execute('SELECT previous_status, new_status, note, created_at FROM repair_status_history WHERE repair_id = ? ORDER BY id', [rows[0].id]);
    response.json({ repair: rows[0], parts, history });
  } catch (error) { next(error); }
});

app.post('/api/repairs/:bookingId', requireAuth, requireAdmin, async (request, response, next) => {
  const bookingId = Number(request.params.bookingId);
  const inspectionNotes = String(request.body.inspectionNotes || '').trim() || null;
  if (!Number.isSafeInteger(bookingId) || bookingId < 1 || (inspectionNotes && inspectionNotes.length > 10000)) {
    return response.status(400).json({ error: 'Check the booking and inspection notes.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [bookings] = await connection.execute('SELECT status, customer_id FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
    if (!bookings.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Booking not found.' });
    }
    if (bookings[0].status !== 'in_progress') {
      await connection.rollback();
      return response.status(409).json({ error: 'Start the repair after the confirmed bicycle has been checked in.' });
    }
    const [result] = await connection.execute(
      'INSERT INTO repair_records (booking_id, status, inspection_notes, updated_by) VALUES (?, ?, ?, ?)',
      [bookingId, 'bicycle_received', inspectionNotes, request.user.id],
    );
    await connection.execute(
      'INSERT INTO repair_status_history (repair_id, previous_status, new_status, note, changed_by) VALUES (?, NULL, ?, ?, ?)',
      [result.insertId, 'bicycle_received', inspectionNotes, request.user.id],
    );
    await connection.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)', [request.user.id, 'repair.created', 'repair', String(result.insertId)]);
    await connection.commit();
    response.status(201).json({ id: result.insertId, message: 'Repair record created.' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'A repair record already exists for this booking.' });
    next(error);
  } finally { connection.release(); }
});

app.put('/api/repairs/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const requestedStatus = request.body.status === undefined ? null : String(request.body.status);
  const inspectionNotes = request.body.inspectionNotes === undefined ? undefined : String(request.body.inspectionNotes || '').trim() || null;
  const completionNotes = request.body.completionNotes === undefined ? undefined : String(request.body.completionNotes || '').trim() || null;
  const estimateAmount = request.body.estimateAmount === undefined ? undefined : Number(request.body.estimateAmount);
  const finalAmount = request.body.finalAmount === undefined ? undefined : Number(request.body.finalAmount);
  const warrantyUntil = request.body.warrantyUntil === undefined ? undefined : request.body.warrantyUntil || null;
  const note = String(request.body.note || '').trim().slice(0, 1000) || null;
  const parts = request.body.parts === undefined ? null : request.body.parts;
  const transitions = {
    bicycle_received: new Set(['inspection']),
    inspection: new Set(['awaiting_customer_approval', 'in_progress']),
    awaiting_customer_approval: new Set(['inspection', 'in_progress']),
    in_progress: new Set(['quality_check']),
    quality_check: new Set(['in_progress', 'ready_for_pickup']),
    ready_for_pickup: new Set(['completed']),
    completed: new Set(),
  };
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid repair record.' });
  if (requestedStatus && !Object.hasOwn(transitions, requestedStatus)) return response.status(400).json({ error: 'Choose a valid repair progress status.' });
  if ((estimateAmount !== undefined && (!Number.isFinite(estimateAmount) || estimateAmount < 0))
      || (finalAmount !== undefined && (!Number.isFinite(finalAmount) || finalAmount < 0))
      || (inspectionNotes && inspectionNotes.length > 10000) || (completionNotes && completionNotes.length > 10000)
      || (parts !== null && (!Array.isArray(parts) || parts.length > 50))) {
    return response.status(400).json({ error: 'Check estimate, final amount, notes, and parts.' });
  }
  if (warrantyUntil !== undefined && warrantyUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(warrantyUntil))) {
    return response.status(400).json({ error: 'Enter a valid warranty end date.' });
  }
  if (parts && parts.some(part => !String(part.name || '').trim() || String(part.name).trim().length > 160
      || !Number.isFinite(Number(part.quantity)) || Number(part.quantity) <= 0
      || !Number.isFinite(Number(part.unitCost)) || Number(part.unitCost) < 0
      || (part.notes && String(part.notes).length > 500))) {
    return response.status(400).json({ error: 'Each part needs a name, positive quantity, nonnegative unit cost, and short notes.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT r.*, b.customer_id, b.status AS booking_status FROM repair_records r
       JOIN bookings b ON b.id = r.booking_id WHERE r.id = ? FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Repair record not found.' });
    }
    const repair = rows[0];
    const nextStatus = estimateAmount !== undefined ? 'awaiting_customer_approval' : (requestedStatus || repair.status);
    if (nextStatus !== repair.status && !transitions[repair.status]?.has(nextStatus)) {
      await connection.rollback();
      return response.status(409).json({ error: `Repair cannot move from ${repair.status} to ${nextStatus}.` });
    }
    if (repair.estimate_status === 'pending' && nextStatus !== 'awaiting_customer_approval') {
      await connection.rollback();
      return response.status(409).json({ error: 'Wait for customer approval or decline before moving the repair forward.' });
    }
    if (finalAmount !== undefined && repair.estimate_amount !== null && finalAmount > Number(repair.estimate_amount)
        && estimateAmount === undefined && repair.estimate_status !== 'approved') {
      await connection.rollback();
      return response.status(409).json({ error: 'Customer approval is required before increasing the approved estimate.' });
    }
    if (nextStatus === 'completed' && (finalAmount === undefined && repair.final_amount === null
        || completionNotes === undefined && !repair.completion_notes)) {
      await connection.rollback();
      return response.status(400).json({ error: 'Record the final cost and completion notes before completing the repair.' });
    }
    const finalEstimateStatus = estimateAmount !== undefined ? 'pending' : repair.estimate_status;
    await connection.execute(
      `UPDATE repair_records SET status = ?, inspection_notes = COALESCE(?, inspection_notes),
       completion_notes = COALESCE(?, completion_notes), estimate_amount = COALESCE(?, estimate_amount),
       estimate_status = ?, final_amount = COALESCE(?, final_amount), warranty_until = COALESCE(?, warranty_until), updated_by = ?
       WHERE id = ?`,
      [nextStatus, inspectionNotes === undefined ? null : inspectionNotes, completionNotes === undefined ? null : completionNotes,
        estimateAmount === undefined ? null : estimateAmount, finalEstimateStatus, finalAmount === undefined ? null : finalAmount,
        warrantyUntil === undefined ? null : warrantyUntil, request.user.id, id],
    );
    if (estimateAmount !== undefined || finalAmount !== undefined) {
      await connection.execute(
        `INSERT INTO payments (booking_id, estimated_amount, final_amount) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE estimated_amount = COALESCE(VALUES(estimated_amount), estimated_amount),
         final_amount = COALESCE(VALUES(final_amount), final_amount)`,
        [repair.booking_id, estimateAmount === undefined ? repair.estimate_amount : estimateAmount, finalAmount === undefined ? repair.final_amount : finalAmount],
      );
      const [[payment]] = await connection.execute('SELECT id FROM payments WHERE booking_id = ?', [repair.booking_id]);
      await updatePaymentSummary(connection, payment.id);
    }
    if (nextStatus !== repair.status) {
      await connection.execute(
        'INSERT INTO repair_status_history (repair_id, previous_status, new_status, note, changed_by) VALUES (?, ?, ?, ?, ?)',
        [id, repair.status, nextStatus, note, request.user.id],
      );
      const title = estimateAmount !== undefined ? 'Repair estimate needs your approval' : 'Repair progress updated';
      const body = estimateAmount !== undefined ? `The mechanic proposed an estimate of PHP ${estimateAmount.toFixed(2)}.` : (note || `Repair status: ${nextStatus.replaceAll('_', ' ')}.`);
      await notify(connection, repair.customer_id, estimateAmount !== undefined ? 'estimate_approval' : 'repair_progress', title, body, repair.booking_id);
    }
    if (parts) {
      for (const part of parts) {
        await connection.execute(
          'INSERT INTO repair_parts (repair_id, part_name, quantity, unit_cost, notes) VALUES (?, ?, ?, ?, ?)',
          [id, String(part.name).trim(), Number(part.quantity), Number(part.unitCost), String(part.notes || '').trim() || null],
        );
      }
    }
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [request.user.id, `repair.${nextStatus}`, 'repair', String(id), JSON.stringify({ note, estimateAmount: estimateAmount ?? null, finalAmount: finalAmount ?? null })],
    );
    if (nextStatus === 'completed' && repair.booking_status === 'in_progress') {
      await recordTransition(connection, { bookingId: repair.booking_id, from: 'in_progress', to: 'completed', actorId: request.user.id, actorRole: 'admin', note: completionNotes || note });
      await connection.execute("UPDATE bookings SET status = 'completed' WHERE id = ?", [repair.booking_id]);
    }
    await connection.commit();
    response.json({ message: 'Repair record updated.' });
  } catch (error) {
    await connection.rollback();
    if (error.statusCode) return response.status(error.statusCode).json({ error: error.message });
    next(error);
  } finally { connection.release(); }
});

app.patch('/api/repairs/:id/estimate', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const id = Number(request.params.id);
  const decision = String(request.body.decision || '');
  if (!Number.isSafeInteger(id) || id < 1 || !['approved', 'declined'].includes(decision)) return response.status(400).json({ error: 'Choose approve or decline for this estimate.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT r.*, b.customer_id, b.id AS booking_id FROM repair_records r
       JOIN bookings b ON b.id = r.booking_id WHERE r.id = ? AND b.customer_id = ? FOR UPDATE`,
      [id, request.user.id],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Estimate not found.' });
    }
    const repair = rows[0];
    if (repair.estimate_status !== 'pending' || repair.status !== 'awaiting_customer_approval') {
      await connection.rollback();
      return response.status(409).json({ error: 'There is no estimate awaiting your response.' });
    }
    const nextStatus = decision === 'approved' ? 'in_progress' : 'inspection';
    await connection.execute('UPDATE repair_records SET estimate_status = ?, status = ? WHERE id = ?', [decision, nextStatus, id]);
    await connection.execute(
      'INSERT INTO repair_status_history (repair_id, previous_status, new_status, note, changed_by) VALUES (?, ?, ?, ?, ?)',
      [id, repair.status, nextStatus, `Customer ${decision} the estimate.`, request.user.id],
    );
    const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    for (const admin of admins) await notify(connection, admin.id, 'estimate_response', 'Customer responded to estimate', `The customer ${decision} the repair estimate.`, repair.booking_id);
    await connection.commit();
    response.json({ message: `Estimate ${decision}.` });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get('/api/customers/me/payments', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  try {
    const [payments] = await pool.execute(
      `SELECT p.id, p.booking_id, p.estimated_amount, p.final_amount, p.status, p.created_at, p.updated_at, b.booking_ref
       FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_id = ? ORDER BY p.updated_at DESC`,
      [request.user.id],
    );
    for (const payment of payments) {
      const [transactions] = await pool.execute(
        'SELECT id, method, amount, transaction_ref, status, admin_note, verified_at, created_at FROM payment_transactions WHERE payment_id = ? AND booking_group_payment_id IS NULL ORDER BY created_at DESC',
        [payment.id],
      );
      payment.transactions = transactions;
    }
    response.json({ payments });
  } catch (error) { next(error); }
});

app.get('/api/payments', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [payments] = await pool.execute(
      `SELECT p.id, p.booking_id, p.estimated_amount, p.final_amount, p.status, p.created_at, p.updated_at,
       b.booking_ref, u.full_name AS customer_name, u.email AS customer_email
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN users u ON u.id = b.customer_id
       ORDER BY p.updated_at DESC`,
    );
    for (const payment of payments) {
      const [transactions] = await pool.execute(
        'SELECT id, method, amount, transaction_ref, status, proof_path IS NOT NULL AS has_proof, admin_note, verified_at, created_at FROM payment_transactions WHERE payment_id = ? AND booking_group_payment_id IS NULL ORDER BY created_at DESC',
        [payment.id],
      );
      payment.transactions = transactions;
    }
    response.json({ payments });
  } catch (error) { next(error); }
});

app.post('/api/payments', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const bookingId = Number(request.body.bookingId);
  const amount = Number(request.body.amount);
  const method = String(request.body.method || '');
  const transactionRef = String(request.body.transactionRef || '').trim();
  const proof = parseProofDataUrl(request.body.proofData);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1 || !Number.isFinite(amount) || amount <= 0 || amount > 10000000
      || !['gcash', 'bank_transfer'].includes(method) || transactionRef.length < 3 || transactionRef.length > 160 || !proof) {
    return response.status(400).json({ error: 'Enter a valid amount, transfer method, transaction reference, and JPEG/PNG/PDF proof up to 5 MB.' });
  }
  let savedFile;
  const connection = await pool.getConnection();
  try {
    savedFile = await saveProof(proof);
    await connection.beginTransaction();
    const [bookings] = await connection.execute(
      `SELECT id, customer_id, status, reservation_expires_at
       FROM bookings WHERE id = ? AND customer_id = ? FOR UPDATE`,
      [bookingId, request.user.id],
    );
    if (!bookings.length) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(404).json({ error: 'Booking not found.' });
    }
    const booking = bookings[0];
    if (!['awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'in_progress', 'completed'].includes(booking.status)) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'Payment can only be submitted for an approved booking or an outstanding repair balance.' });
    }
    if (booking.status === 'awaiting_payment' && (!booking.reservation_expires_at || new Date(booking.reservation_expires_at) <= new Date())) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'The two-hour payment reservation expired. Contact the mechanic to request a new time.' });
    }
    const [[payment]] = await connection.execute('SELECT id, final_amount, estimated_amount FROM payments WHERE booking_id = ? FOR UPDATE', [bookingId]);
    if (!payment) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'The approved booking has no payment record. Contact the mechanic.' });
    }
    const [[totals]] = await connection.execute(
      `SELECT COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS verified,
       COALESCE(SUM(CASE WHEN status IN ('pending', 'submitted') THEN amount ELSE 0 END), 0) AS outstanding
       FROM payment_transactions WHERE payment_id = ?`,
      [payment.id],
    );
    const target = Number(payment.final_amount ?? payment.estimated_amount);
    if (amount + Number(totals.verified) + Number(totals.outstanding) > target) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'This payment exceeds the remaining repair balance.' });
    }
    if (Number(totals.outstanding) > 0) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'A payment submission is already awaiting mechanic verification.' });
    }
    const [transaction] = await connection.execute(
      `INSERT INTO payment_transactions (payment_id, method, amount, transaction_ref, proof_path, status)
       VALUES (?, ?, ?, ?, ?, 'submitted')`,
      [payment.id, method, amount, transactionRef, savedFile.filename],
    );
    if (['awaiting_payment', 'payment_rejected'].includes(booking.status)) {
      await recordTransition(connection, {
        bookingId,
        from: booking.status,
        to: 'payment_submitted',
        actorId: request.user.id,
        actorRole: 'customer',
        note: 'Customer submitted payment proof for verification.',
      });
      await connection.execute("UPDATE bookings SET status = 'payment_submitted' WHERE id = ?", [bookingId]);
    }
    const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    for (const admin of admins) await notify(connection, admin.id, 'payment_submitted', 'Payment proof submitted', `A customer submitted payment proof for booking ${bookingId}.`, bookingId);
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [request.user.id, 'payment.submitted', 'payment_transaction', String(transaction.insertId)],
    );
    await connection.commit();
    response.status(201).json({ id: transaction.insertId, status: 'submitted', message: 'Payment submitted for mechanic verification.' });
  } catch (error) {
    await connection.rollback();
    if (savedFile) await fs.promises.unlink(savedFile.fullPath).catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'That transaction reference has already been submitted.' });
    next(error);
  } finally { connection.release(); }
});

app.post('/api/booking-groups/:id/payments', requireAuth, async (request, response, next) => {
  if (request.user.role !== 'customer') return response.status(403).json({ error: 'Customer account required.' });
  const groupId = Number(request.params.id);
  const amount = Number(request.body.amount);
  const method = String(request.body.method || '');
  const transactionRef = String(request.body.transactionRef || '').trim();
  const proof = parseProofDataUrl(request.body.proofData);
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isFinite(amount) || amount <= 0 || amount > 10000000
      || !['gcash', 'bank_transfer'].includes(method) || transactionRef.length < 3 || transactionRef.length > 160 || !proof) {
    return response.status(400).json({ error: 'Enter a valid total, transfer method, transaction reference, and JPEG/PNG/PDF proof up to 5 MB.' });
  }
  let savedFile;
  const connection = await pool.getConnection();
  try {
    savedFile = await saveProof(proof);
    await connection.beginTransaction();
    const [groups] = await connection.execute(
      'SELECT id, group_ref, payment_choice FROM booking_groups WHERE id = ? AND customer_id = ? FOR UPDATE',
      [groupId, request.user.id],
    );
    if (!groups.length) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(404).json({ error: 'Booking group not found.' });
    }
    if (groups[0].payment_choice !== 'together') {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'This request is set up for separate bicycle payments.' });
    }
    const [bookings] = await connection.execute(
      `SELECT b.id, b.status, b.reservation_expires_at, p.id AS payment_id,
       p.final_amount, p.estimated_amount,
       COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt
         WHERE pt.payment_id = p.id AND pt.status = 'verified'), 0) AS verified_amount,
       COALESCE((SELECT COUNT(*) FROM payment_transactions pt
         WHERE pt.payment_id = p.id AND pt.status IN ('pending', 'submitted')), 0) AS pending_count
       FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.booking_group_id = ? AND b.customer_id = ? ORDER BY b.id FOR UPDATE`,
      [groupId, request.user.id],
    );
    const [existingSubmissions] = await connection.execute(
      "SELECT id FROM booking_group_payments WHERE group_id = ? AND status = 'submitted' FOR UPDATE",
      [groupId],
    );
    if (!bookings.length || bookings.some(booking => !booking.payment_id
        || !['awaiting_payment', 'payment_rejected'].includes(booking.status)
        || !booking.reservation_expires_at || new Date(booking.reservation_expires_at) <= new Date()
        || Number(booking.pending_count) > 0) || existingSubmissions.length) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: 'Combined payment is available after every bicycle has an active, approved reservation and no payment is awaiting review.' });
    }
    const balances = bookings.map(booking => {
      const target = Number(booking.final_amount ?? booking.estimated_amount ?? 0);
      return { booking, balance: Math.max(0, Math.round((target - Number(booking.verified_amount)) * 100) / 100) };
    }).filter(item => item.balance > 0);
    const totalDueCents = balances.reduce((sum, item) => sum + Math.round(item.balance * 100), 0);
    if (!balances.length || Math.round(amount * 100) !== totalDueCents) {
      await connection.rollback();
      await fs.promises.unlink(savedFile.fullPath).catch(() => {});
      return response.status(409).json({ error: `Enter the exact combined outstanding balance of PHP ${(totalDueCents / 100).toFixed(2)}.` });
    }
    const [submission] = await connection.execute(
      `INSERT INTO booking_group_payments (group_id, method, amount, transaction_ref, proof_path, status)
       VALUES (?, ?, ?, ?, ?, 'submitted')`,
      [groupId, method, amount, transactionRef, savedFile.filename],
    );
    for (const { booking, balance } of balances) {
      await connection.execute(
        `INSERT INTO payment_transactions
         (payment_id, booking_group_payment_id, method, amount, transaction_ref, proof_path, status)
         VALUES (?, ?, ?, ?, NULL, ?, 'submitted')`,
        [booking.payment_id, submission.insertId, method, balance, savedFile.filename],
      );
      await updatePaymentSummary(connection, booking.payment_id);
      if (booking.status !== 'payment_submitted') {
        await recordTransition(connection, {
          bookingId: booking.id, from: booking.status, to: 'payment_submitted',
          actorId: request.user.id, actorRole: 'customer',
          note: 'Customer submitted combined payment proof for the booking group.',
        });
        await connection.execute("UPDATE bookings SET status = 'payment_submitted' WHERE id = ?", [booking.id]);
      }
    }
    const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    for (const admin of admins) {
      await notify(connection, admin.id, 'payment_submitted', 'Combined payment proof submitted', `A customer submitted payment for group ${groups[0].group_ref}.`, balances[0].booking.id);
    }
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [request.user.id, 'payment.group_submitted', 'booking_group_payment', String(submission.insertId)],
    );
    await connection.commit();
    response.status(201).json({ id: submission.insertId, status: 'submitted', message: 'Combined payment submitted for mechanic verification.' });
  } catch (error) {
    await connection.rollback();
    if (savedFile) await fs.promises.unlink(savedFile.fullPath).catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'That transaction reference has already been submitted.' });
    next(error);
  } finally { connection.release(); }
});

app.get('/api/booking-group-payments', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [submissions] = await pool.execute(
      `SELECT bgp.id, bgp.group_id, bgp.method, bgp.amount, bgp.transaction_ref, bgp.status,
       bgp.admin_note, bgp.verified_at, bgp.created_at, bg.group_ref, u.full_name AS customer_name
       FROM booking_group_payments bgp
       JOIN booking_groups bg ON bg.id = bgp.group_id
       JOIN users u ON u.id = bg.customer_id
       ORDER BY bgp.created_at DESC`,
    );
    for (const submission of submissions) {
      const [bookings] = await pool.execute(
        'SELECT booking_ref FROM bookings WHERE booking_group_id = ? ORDER BY id',
        [submission.group_id],
      );
      submission.booking_refs = bookings.map(booking => booking.booking_ref);
      submission.has_proof = Boolean(submission.id);
    }
    response.json({ submissions });
  } catch (error) { next(error); }
});

app.get('/api/booking-group-payments/:id/proof', requireAuth, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid group payment.' });
  try {
    const [rows] = await pool.execute(
      `SELECT bgp.proof_path, bg.customer_id FROM booking_group_payments bgp
       JOIN booking_groups bg ON bg.id = bgp.group_id WHERE bgp.id = ?`,
      [id],
    );
    if (!rows.length || (request.user.role !== 'admin' && rows[0].customer_id !== request.user.id)) {
      return response.status(404).json({ error: 'Payment proof not found.' });
    }
    const filename = path.basename(rows[0].proof_path);
    const fullPath = path.join(privateProofDirectory, filename);
    const extension = path.extname(filename).toLowerCase();
    response.setHeader('Content-Type', extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(fullPath).on('error', next).pipe(response);
  } catch (error) { next(error); }
});

app.patch('/api/booking-group-payments/:id/verify', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid group payment.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [submissions] = await connection.execute(
      "SELECT id, group_id, status FROM booking_group_payments WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!submissions.length) { await connection.rollback(); return response.status(404).json({ error: 'Group payment not found.' }); }
    if (submissions[0].status !== 'submitted') { await connection.rollback(); return response.status(409).json({ error: 'This group payment is no longer awaiting verification.' }); }
    const [rows] = await connection.execute(
      `SELECT pt.id AS transaction_id, pt.payment_id, p.booking_id, b.customer_id, b.status AS booking_status
       FROM payment_transactions pt JOIN payments p ON p.id = pt.payment_id
       JOIN bookings b ON b.id = p.booking_id
       WHERE pt.booking_group_payment_id = ? AND pt.status = 'submitted' ORDER BY b.id FOR UPDATE`,
      [id],
    );
    if (!rows.length || rows.some(row => row.booking_status !== 'payment_submitted')) {
      await connection.rollback();
      return response.status(409).json({ error: 'The group payment does not have a complete set of pending bicycle payments.' });
    }
    await connection.execute(
      "UPDATE booking_group_payments SET status = 'verified', verified_by = ?, verified_at = UTC_TIMESTAMP() WHERE id = ?",
      [request.user.id, id],
    );
    await connection.execute(
      "UPDATE payment_transactions SET status = 'verified', verified_by = ?, verified_at = UTC_TIMESTAMP() WHERE booking_group_payment_id = ? AND status = 'submitted'",
      [request.user.id, id],
    );
    for (const row of rows) {
      const summary = await updatePaymentSummary(connection, row.payment_id);
      if (summary.status !== 'paid') {
        await connection.rollback();
        return response.status(409).json({ error: 'The combined amount does not cover every bicycle’s full payment.' });
      }
      await recordTransition(connection, {
        bookingId: row.booking_id, from: 'payment_submitted', to: 'confirmed',
        actorId: request.user.id, actorRole: 'admin',
        note: 'Combined payment verified; appointment confirmed.',
      });
      await connection.execute("UPDATE bookings SET status = 'confirmed', reservation_expires_at = NULL WHERE id = ?", [row.booking_id]);
      await notify(connection, row.customer_id, 'payment_verified', 'Combined payment verified', 'The mechanic verified the combined payment for your booking group.', row.booking_id);
    }
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [request.user.id, 'payment.group_verified', 'booking_group_payment', String(id)],
    );
    await connection.commit();
    response.json({ message: 'Combined payment verified; all bicycle appointments are confirmed.' });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.patch('/api/booking-group-payments/:id/reject', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const note = String(request.body.note || '').trim();
  if (!Number.isSafeInteger(id) || id < 1 || note.length < 3 || note.length > 1000) {
    return response.status(400).json({ error: 'Provide a short reason for rejecting this combined payment.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [submissions] = await connection.execute(
      "SELECT id, group_id, status FROM booking_group_payments WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!submissions.length) { await connection.rollback(); return response.status(404).json({ error: 'Group payment not found.' }); }
    if (submissions[0].status !== 'submitted') { await connection.rollback(); return response.status(409).json({ error: 'This group payment is no longer awaiting review.' }); }
    const [rows] = await connection.execute(
      `SELECT pt.id AS transaction_id, pt.payment_id, p.booking_id, b.customer_id, b.status AS booking_status
       FROM payment_transactions pt JOIN payments p ON p.id = pt.payment_id
       JOIN bookings b ON b.id = p.booking_id
       WHERE pt.booking_group_payment_id = ? AND pt.status = 'submitted' ORDER BY b.id FOR UPDATE`,
      [id],
    );
    await connection.execute(
      "UPDATE booking_group_payments SET status = 'rejected', admin_note = ?, verified_by = ?, verified_at = UTC_TIMESTAMP() WHERE id = ?",
      [note, request.user.id, id],
    );
    await connection.execute(
      "UPDATE payment_transactions SET status = 'rejected', admin_note = ?, verified_by = ?, verified_at = UTC_TIMESTAMP() WHERE booking_group_payment_id = ? AND status = 'submitted'",
      [note, request.user.id, id],
    );
    for (const row of rows) {
      await updatePaymentSummary(connection, row.payment_id);
      if (row.booking_status === 'payment_submitted') {
        await recordTransition(connection, {
          bookingId: row.booking_id, from: 'payment_submitted', to: 'payment_rejected',
          actorId: request.user.id, actorRole: 'admin', note,
        });
        await connection.execute("UPDATE bookings SET status = 'payment_rejected' WHERE id = ?", [row.booking_id]);
      }
    }
    await connection.commit();
    response.json({ message: 'Combined payment rejected.' });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.get('/api/payments/transactions/:id/proof', requireAuth, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid payment transaction.' });
  try {
    const [rows] = await pool.execute(
      `SELECT pt.proof_path, b.customer_id FROM payment_transactions pt JOIN payments p ON p.id = pt.payment_id
       JOIN bookings b ON b.id = p.booking_id WHERE pt.id = ?`,
      [id],
    );
    if (!rows.length || (request.user.role !== 'admin' && rows[0].customer_id !== request.user.id)) return response.status(404).json({ error: 'Payment proof not found.' });
    if (!rows[0].proof_path) return response.status(404).json({ error: 'This payment has no uploaded proof.' });
    const filename = path.basename(rows[0].proof_path);
    const fullPath = path.join(privateProofDirectory, filename);
    const extension = path.extname(filename).toLowerCase();
    const contentType = extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'application/pdf';
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(fullPath).on('error', next).pipe(response);
  } catch (error) { next(error); }
});

app.patch('/api/payments/transactions/:id/verify', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid payment transaction.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT pt.id, pt.payment_id, pt.status, p.booking_id, b.customer_id, b.status AS booking_status,
       b.reservation_expires_at FROM payment_transactions pt
       JOIN payments p ON p.id = pt.payment_id JOIN bookings b ON b.id = p.booking_id WHERE pt.id = ? FOR UPDATE`,
      [id],
    );
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ error: 'Payment transaction not found.' }); }
    const transaction = rows[0];
    if (!['pending', 'submitted'].includes(transaction.status)) { await connection.rollback(); return response.status(409).json({ error: 'This payment is no longer awaiting verification.' }); }
    await connection.execute("UPDATE payment_transactions SET status = 'verified', verified_by = ?, verified_at = UTC_TIMESTAMP() WHERE id = ?", [request.user.id, id]);
    const summary = await updatePaymentSummary(connection, transaction.payment_id);
    if (summary.status === 'paid' && transaction.booking_status === 'payment_submitted') {
      await recordTransition(connection, {
        bookingId: transaction.booking_id,
        from: 'payment_submitted',
        to: 'confirmed',
        actorId: request.user.id,
        actorRole: 'admin',
        note: 'Payment verified; appointment confirmed.',
      });
      await connection.execute(
        "UPDATE bookings SET status = 'confirmed', reservation_expires_at = NULL WHERE id = ?",
        [transaction.booking_id],
      );
    }
    await notify(connection, transaction.customer_id, 'payment_verified', 'Payment verified', 'The mechanic verified your payment.', transaction.booking_id);
    await connection.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)', [request.user.id, 'payment.verified', 'payment_transaction', String(id)]);
    await connection.commit();
    response.json({ message: 'Payment verified.', paymentStatus: summary.status });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.patch('/api/payments/transactions/:id/reject', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const note = String(request.body.note || '').trim();
  if (!Number.isSafeInteger(id) || id < 1 || note.length < 3 || note.length > 1000) return response.status(400).json({ error: 'Provide a short reason for rejecting this payment.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT pt.id, pt.payment_id, pt.status, p.booking_id, b.customer_id, b.status AS booking_status,
       b.reservation_expires_at FROM payment_transactions pt
       JOIN payments p ON p.id = pt.payment_id JOIN bookings b ON b.id = p.booking_id WHERE pt.id = ? FOR UPDATE`,
      [id],
    );
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ error: 'Payment transaction not found.' }); }
    const transaction = rows[0];
    if (!['pending', 'submitted'].includes(transaction.status)) { await connection.rollback(); return response.status(409).json({ error: 'This payment is no longer awaiting review.' }); }
    await connection.execute("UPDATE payment_transactions SET status = 'rejected', admin_note = ?, verified_by = ?, verified_at = UTC_TIMESTAMP() WHERE id = ?", [note, request.user.id, id]);
    const summary = await updatePaymentSummary(connection, transaction.payment_id);
    if (transaction.booking_status === 'payment_submitted' && summary.pendingCount === 0) {
      const expired = !transaction.reservation_expires_at || new Date(transaction.reservation_expires_at) <= new Date();
      const nextStatus = expired ? 'payment_rejected' : 'awaiting_payment';
      await recordTransition(connection, {
        bookingId: transaction.booking_id,
        from: 'payment_submitted',
        to: nextStatus,
        actorId: request.user.id,
        actorRole: 'admin',
        note,
      });
      await connection.execute(
        'UPDATE bookings SET status = ?, reservation_expires_at = ? WHERE id = ?',
        [nextStatus, expired ? null : transaction.reservation_expires_at, transaction.booking_id],
      );
    }
    await notify(connection, transaction.customer_id, 'payment_rejected', 'Payment needs attention', note, transaction.booking_id);
    await connection.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', [request.user.id, 'payment.rejected', 'payment_transaction', String(id), JSON.stringify({ note })]);
    await connection.commit();
    response.json({ message: 'Payment rejected.', paymentStatus: summary.status });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.post('/api/admin/payments/cash', requireAuth, requireAdmin, async (request, response, next) => {
  const bookingId = Number(request.body.bookingId);
  const amount = Number(request.body.amount);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1 || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) return response.status(400).json({ error: 'Enter a valid booking and cash amount.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT b.customer_id, b.status AS booking_status, b.reservation_expires_at,
       p.id AS payment_id, p.final_amount, p.estimated_amount
       FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE b.id = ? FOR UPDATE`,
      [bookingId],
    );
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ error: 'Payment record not found for this booking.' }); }
    const payment = rows[0];
    if (payment.booking_status === 'awaiting_payment'
        && (!payment.reservation_expires_at || new Date(payment.reservation_expires_at) <= new Date())) {
      await connection.rollback();
      return response.status(409).json({ error: 'The two-hour payment reservation expired. Reapprove the booking before recording payment.' });
    }
    const [[totals]] = await connection.execute("SELECT COALESCE(SUM(amount), 0) AS verified FROM payment_transactions WHERE payment_id = ? AND status = 'verified'", [payment.payment_id]);
    const target = Number(payment.final_amount ?? payment.estimated_amount ?? 0);
    if (!target || Number(totals.verified) + amount > target) { await connection.rollback(); return response.status(409).json({ error: 'Cash amount exceeds the remaining repair balance.' }); }
    const reference = `CASH-${crypto.randomUUID()}`;
    const [result] = await connection.execute(
      `INSERT INTO payment_transactions (payment_id, method, amount, transaction_ref, status, verified_by, verified_at, admin_note)
       VALUES (?, 'cash', ?, ?, 'verified', ?, UTC_TIMESTAMP(), 'Cash received by mechanic')`,
      [payment.payment_id, amount, reference, request.user.id],
    );
    const summary = await updatePaymentSummary(connection, payment.payment_id);
    if (summary.status === 'paid' && payment.booking_status === 'awaiting_payment') {
      await recordTransition(connection, {
        bookingId,
        from: 'awaiting_payment',
        to: 'confirmed',
        actorId: request.user.id,
        actorRole: 'admin',
        note: 'Full cash payment received; appointment confirmed.',
      });
      await connection.execute(
        "UPDATE bookings SET status = 'confirmed', reservation_expires_at = NULL WHERE id = ?",
        [bookingId],
      );
    }
    await notify(connection, payment.customer_id, 'payment_verified', 'Cash payment recorded', `The mechanic recorded PHP ${amount.toFixed(2)} in cash.`, bookingId);
    await connection.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)', [request.user.id, 'payment.cash_recorded', 'payment_transaction', String(result.insertId)]);
    await connection.commit();
    response.status(201).json({ id: result.insertId, paymentStatus: summary.status, message: 'Cash payment recorded.' });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.post('/api/payments/transactions/:id/refund', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const note = String(request.body.note || '').trim().slice(0, 1000) || 'Refund issued by mechanic';
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid payment transaction.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT pt.*, p.booking_id, b.customer_id FROM payment_transactions pt
       JOIN payments p ON p.id = pt.payment_id JOIN bookings b ON b.id = p.booking_id WHERE pt.id = ? FOR UPDATE`,
      [id],
    );
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ error: 'Payment transaction not found.' }); }
    const transaction = rows[0];
    if (transaction.status !== 'verified') { await connection.rollback(); return response.status(409).json({ error: 'Only verified payments can be refunded.' }); }
    await connection.execute("UPDATE payment_transactions SET status = 'refunded', admin_note = ? WHERE id = ?", [note, id]);
    const refundRef = `REFUND-${id}-${crypto.randomUUID().slice(0, 8)}`;
    await connection.execute(
      `INSERT INTO payment_transactions (payment_id, method, amount, transaction_ref, status, admin_note, verified_by, verified_at)
       VALUES (?, ?, ?, ?, 'refunded', ?, ?, UTC_TIMESTAMP())`,
      [transaction.payment_id, transaction.method, transaction.amount, refundRef, note, request.user.id],
    );
    const summary = await updatePaymentSummary(connection, transaction.payment_id);
    await notify(connection, transaction.customer_id, 'payment_refunded', 'Payment refunded', note, transaction.booking_id);
    await connection.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', [request.user.id, 'payment.refunded', 'payment_transaction', String(id), JSON.stringify({ amount: transaction.amount, note })]);
    await connection.commit();
    response.json({ message: 'Full payment refund recorded.', paymentStatus: summary.status });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.get('/api/admin/bookings', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.booking_ref, b.bicycle_type, b.bicycle_brand, b.bicycle_model,
        b.problem_description, b.preferred_at, b.scheduled_at, b.status, b.admin_note, b.created_at,
        bg.group_ref, bg.payment_choice,
        (SELECT COUNT(*) FROM booking_photos bp WHERE bp.booking_id = b.id) AS photo_count,
        u.full_name AS customer_name, u.email AS customer_email,
        COALESCE((SELECT GROUP_CONCAT(selected_service.name ORDER BY selected_service.name SEPARATOR ', ')
          FROM booking_services bs JOIN services selected_service ON selected_service.id = bs.service_id
          WHERE bs.booking_id = b.id), s.name) AS service_name
       FROM bookings b JOIN users u ON u.id = b.customer_id JOIN services s ON s.id = b.service_id
       LEFT JOIN booking_groups bg ON bg.id = b.booking_group_id
       ORDER BY FIELD(b.status, 'pending_review', 'awaiting_customer_response', 'confirmed', 'rejected', 'cancelled', 'completed'), b.created_at DESC`,
    );
    response.json({ bookings: rows });
  } catch (error) { next(error); }
});

app.patch('/api/admin/bookings/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const status = String(request.body.status || '');
  const scheduledAt = request.body.scheduledAt ? new Date(request.body.scheduledAt) : null;
  const adminNote = String(request.body.adminNote || '').trim().slice(0, 1000) || null;
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid booking.' });
  if (!['awaiting_payment', 'awaiting_customer_response', 'awaiting_customer', 'rejected', 'cancelled', 'no_show', 'in_progress', 'completed'].includes(status)) return response.status(400).json({ error: 'Choose an allowed job status.' });
  if (status === 'awaiting_payment' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())) {
    return response.status(400).json({ error: 'Set a future proposed drop-off time before approving the booking.' });
  }
  const connection = await pool.getConnection();
  try {
    if (status === 'awaiting_payment') await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT status FROM bookings WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Booking not found.' });
    }
    const previousStatus = rows[0].status;
    await recordTransition(connection, {
      bookingId: id,
      from: previousStatus,
      to: status,
      actorId: request.user.id,
      actorRole: 'admin',
      note: adminNote,
    });
    if (status === 'awaiting_payment') {
      const [[durationRow]] = await connection.execute(
        `SELECT COALESCE(NULLIF(SUM(bs.duration_snapshot), 0), MAX(s.estimated_minutes), 60) AS duration_minutes
         FROM bookings b JOIN services s ON s.id = b.service_id
         LEFT JOIN booking_services bs ON bs.booking_id = b.id WHERE b.id = ? GROUP BY b.id`,
        [id],
      );
      const durationMinutes = Number(durationRow?.duration_minutes || 60);
      if (durationMinutes > 1440) {
        await connection.rollback();
        return response.status(409).json({ error: 'The combined service duration exceeds one day.' });
      }
      const availability = await slotCheck(connection, { startAt: scheduledAt, durationMinutes, excludeBookingId: id, lockSchedule: true });
      if (!availability.available) {
        await connection.rollback();
        return response.status(409).json({ error: availability.reason });
      }
      const [[priceRow]] = await connection.execute(
        `SELECT COALESCE(NULLIF(SUM(bs.unit_price_snapshot), 0), MAX(s.starting_price), 0) AS estimated_amount
         FROM bookings b JOIN services s ON s.id = b.service_id
         LEFT JOIN booking_services bs ON bs.booking_id = b.id WHERE b.id = ? GROUP BY b.id`,
        [id],
      );
      await connection.execute(
        `INSERT INTO payments (booking_id, estimated_amount) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE estimated_amount = COALESCE(estimated_amount, VALUES(estimated_amount))`,
        [id, priceRow.estimated_amount],
      );
    }
    const scheduledValue = status === 'awaiting_payment' ? mysqlDateTime(scheduledAt) : null;
    const reservationExpiresAt = status === 'awaiting_payment'
      ? mysqlDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000))
      : null;
    await connection.execute(
      `UPDATE bookings SET status = ?, scheduled_at = COALESCE(?, scheduled_at),
       reservation_expires_at = ?, admin_note = ? WHERE id = ?`,
      [status, scheduledValue, reservationExpiresAt, adminNote, id],
    );
    await connection.commit();
    response.json({ message: 'Booking updated.' });
  } catch (error) {
    await connection.rollback();
    if (error.statusCode) return response.status(error.statusCode).json({ error: error.message });
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'That drop-off time is already reserved.' });
    next(error);
  } finally { connection.release(); }
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [[totals]] = await pool.execute(`SELECT
      COALESCE(SUM(status = 'pending_review'), 0) AS pending_total,
      COALESCE(SUM(DATE(created_at) = UTC_DATE()), 0) AS received_today,
      COALESCE(SUM(status IN ('confirmed', 'completed') AND DATE(scheduled_at) = UTC_DATE()), 0) AS appointments_today,
      COALESCE(SUM(status = 'cancelled' AND DATE(updated_at) = UTC_DATE()), 0) AS cancelled_today
      FROM bookings`);
    const [dailyAppointments] = await pool.execute(`SELECT DATE(scheduled_at) AS day,
      COUNT(*) AS appointments FROM bookings WHERE status IN ('confirmed', 'completed') AND scheduled_at IS NOT NULL
      AND DATE(scheduled_at) >= DATE_SUB(UTC_DATE(), INTERVAL 6 DAY) GROUP BY DATE(scheduled_at)`);
    const [dailyReceived] = await pool.execute(`SELECT DATE(created_at) AS day, COUNT(*) AS received FROM bookings
      WHERE DATE(created_at) >= DATE_SUB(UTC_DATE(), INTERVAL 6 DAY) GROUP BY DATE(created_at)`);
    const [dailyCancelled] = await pool.execute(`SELECT DATE(updated_at) AS day, COUNT(*) AS cancelled FROM bookings
      WHERE status = 'cancelled' AND DATE(updated_at) >= DATE_SUB(UTC_DATE(), INTERVAL 6 DAY) GROUP BY DATE(updated_at)`);
    const dayKey = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const days = new Map();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - offset);
      const key = date.toISOString().slice(0, 10); days.set(key, { day: key, appointments: 0, received: 0, cancelled: 0 });
    }
    for (const row of dailyAppointments) days.get(dayKey(row.day)) && (days.get(dayKey(row.day)).appointments = Number(row.appointments));
    for (const row of dailyReceived) days.get(dayKey(row.day)) && (days.get(dayKey(row.day)).received = Number(row.received));
    for (const row of dailyCancelled) days.get(dayKey(row.day)) && (days.get(dayKey(row.day)).cancelled = Number(row.cancelled));
    const daily = [...days.values()];
    const [popular] = await pool.execute(`SELECT s.name, COUNT(*) AS bookings
      FROM (
        SELECT booking_id, service_id FROM booking_services
        UNION SELECT id AS booking_id, service_id FROM bookings
      ) selected JOIN services s ON s.id = selected.service_id
      GROUP BY s.id, s.name ORDER BY bookings DESC LIMIT 5`);
    const [[hours]] = await pool.execute(`SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND,
      GREATEST(started_at, UTC_DATE()), LEAST(COALESCE(ended_at, UTC_TIMESTAMP()), DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)))), 0) AS seconds
      FROM work_sessions WHERE started_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)
      AND COALESCE(ended_at, UTC_TIMESTAMP()) > UTC_DATE()`);
    const [[active]] = await pool.execute('SELECT id, started_at FROM work_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1');
    const [[bookingMode]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'booking_enabled'");
    response.json({
      totals: { ...totals, working_hours_today: Number(hours.seconds) / 3600 },
      daily, popular, activeSession: active || null, bookingEnabled: bookingMode?.setting_value !== 'false',
    });
  } catch (error) { next(error); }
});

app.get('/api/admin/services', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [services] = await pool.execute('SELECT id, name, description, starting_price, estimated_minutes, requires_inspection, is_active FROM services ORDER BY is_active DESC, name');
    response.json({ services });
  } catch (error) { next(error); }
});

app.get('/api/admin/announcements', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [announcements] = await pool.execute('SELECT id, title, body, event_at, is_published, created_at FROM announcements ORDER BY created_at DESC LIMIT 50');
    response.json({ announcements });
  } catch (error) { next(error); }
});

app.get('/api/admin/workshop-location', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [[setting]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'workshop_address'");
    response.json({ address: setting?.setting_value || '' });
  } catch (error) { next(error); }
});

app.put('/api/admin/workshop-location', requireAuth, requireAdmin, async (request, response, next) => {
  const address = String(request.body.address || '').trim();
  if (address.length < 10 || address.length > 1000) {
    return response.status(400).json({ error: 'Enter the complete workshop address (10 to 1,000 characters).' });
  }
  try {
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('workshop_address', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [address],
    );
    await pool.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [request.user.id, 'workshop.location_updated', 'app_setting', 'workshop_address'],
    );
    response.json({ message: 'Private workshop address saved.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/work-sessions/start', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [[active]] = await pool.execute('SELECT id FROM work_sessions WHERE ended_at IS NULL LIMIT 1');
    if (active) return response.status(409).json({ error: 'A work session is already running.' });
    const [result] = await pool.execute('INSERT INTO work_sessions (started_at) VALUES (UTC_TIMESTAMP())');
    response.status(201).json({ id: result.insertId, message: 'Work session started.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/work-sessions/stop', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const [result] = await pool.execute('UPDATE work_sessions SET ended_at = UTC_TIMESTAMP() WHERE ended_at IS NULL');
    if (!result.affectedRows) return response.status(409).json({ error: 'There is no active work session.' });
    response.json({ message: 'Work session stopped.' });
  } catch (error) { next(error); }
});

app.put('/api/admin/booking-mode', requireAuth, requireAdmin, async (request, response, next) => {
  const pin = String(request.body.pin || '');
  const enabled = request.body.enabled === true;
  if (!/^\d{4,12}$/.test(pin)) return response.status(400).json({ error: 'Enter the 4 to 12 digit emergency PIN.' });
  try {
    const [[stored]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'emergency_pin_hash'");
    if (!stored?.setting_value) return response.status(503).json({ error: 'Emergency PIN is not configured. Set BOOKING_CONTROL_PIN in BACKEND/.env and rerun npm run create-admin.' });
    if (!(await bcrypt.compare(pin, stored.setting_value))) return response.status(403).json({ error: 'Emergency PIN is incorrect.' });
    await pool.execute("UPDATE app_settings SET setting_value = ? WHERE setting_key = 'booking_enabled'", [String(enabled)]);
    response.json({ enabled, message: enabled ? 'Online bookings are open.' : 'Online bookings are paused.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/services', requireAuth, requireAdmin, async (request, response, next) => {
  const name = String(request.body.name || '').trim();
  const description = String(request.body.description || '').trim();
  const price = Number(request.body.startingPrice);
  const minutes = Number(request.body.estimatedMinutes);
  const requiresInspection = request.body.requiresInspection === true || request.body.requiresInspection === 'on';
  if (name.length < 2 || name.length > 120 || !description || description.length > 2000 || !Number.isFinite(price) || price < 0 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return response.status(400).json({ error: 'Provide a service name, description, valid price, and duration.' });
  }
  try {
    const [result] = await pool.execute('INSERT INTO services (name, description, starting_price, estimated_minutes, requires_inspection) VALUES (?, ?, ?, ?, ?)', [name, description, price, minutes, requiresInspection]);
    response.status(201).json({ id: result.insertId, message: 'Service added.' });
  } catch (error) { next(error); }
});

app.put('/api/admin/services/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const name = String(request.body.name || '').trim();
  const description = String(request.body.description || '').trim();
  const price = Number(request.body.startingPrice);
  const minutes = Number(request.body.estimatedMinutes);
  const requiresInspection = request.body.requiresInspection === true || request.body.requiresInspection === 'on';
  const isActive = request.body.isActive === true || request.body.isActive === 'on';
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid service.' });
  if (name.length < 2 || name.length > 120 || !description || description.length > 2000 || !Number.isFinite(price) || price < 0 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return response.status(400).json({ error: 'Provide a service name, description, valid price, and duration.' });
  }
  try {
    const [result] = await pool.execute('UPDATE services SET name = ?, description = ?, starting_price = ?, estimated_minutes = ?, requires_inspection = ?, is_active = ? WHERE id = ?', [name, description, price, minutes, requiresInspection, isActive, id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Service not found.' });
    response.json({ message: 'Service saved.' });
  } catch (error) { next(error); }
});

app.delete('/api/admin/services/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid service.' });
  try {
    const [result] = await pool.execute('DELETE FROM services WHERE id = ?', [id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Service not found.' });
    response.json({ message: 'Service deleted.' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return response.status(409).json({ error: 'This service is attached to booking history. Hide it instead so past bookings remain intact.' });
    next(error);
  }
});

app.patch('/api/admin/services/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof request.body.isActive !== 'boolean') return response.status(400).json({ error: 'Invalid service update.' });
  try {
    const [result] = await pool.execute('UPDATE services SET is_active = ? WHERE id = ?', [request.body.isActive, id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Service not found.' });
    response.json({ message: 'Service updated.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/builds', requireAuth, requireAdmin, async (request, response, next) => {
  const title = String(request.body.title || '').trim();
  const ownerName = String(request.body.ownerName || '').trim();
  const socialUrl = String(request.body.socialUrl || '').trim();
  const match = String(request.body.imageData || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (title.length < 2 || title.length > 140 || ownerName.length < 2 || ownerName.length > 120 || (socialUrl && (!/^https:\/\//i.test(socialUrl) || socialUrl.length > 500)) || !match) {
    return response.status(400).json({ error: 'Add a title, owner name, public HTTPS social link, and JPEG/PNG/WebP photo.' });
  }
  const imageBuffer = Buffer.from(match[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) return response.status(413).json({ error: 'Build photo must be 5 MB or smaller.' });
  try {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
    const fileName = `${crypto.randomUUID()}.${extension}`;
    await fs.promises.writeFile(path.join(uploadDirectory, fileName), imageBuffer, { flag: 'wx' });
    const imageUrl = `/uploads/${fileName}`;
    const [result] = await pool.execute('INSERT INTO mechanic_builds (title, image_url, owner_name, social_url) VALUES (?, ?, ?, ?)', [title, imageUrl, ownerName, socialUrl || null]);
    response.status(201).json({ build: { id: result.insertId, title, image_url: imageUrl, owner_name: ownerName, social_url: socialUrl || null } });
  } catch (error) { next(error); }
});

app.put('/api/admin/builds/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const title = String(request.body.title || '').trim();
  const ownerName = String(request.body.ownerName || '').trim();
  const socialUrl = String(request.body.socialUrl || '').trim();
  const imageData = String(request.body.imageData || '');
  const match = imageData ? imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid featured build.' });
  if (title.length < 2 || title.length > 140 || ownerName.length < 2 || ownerName.length > 120 || (socialUrl && (!/^https:\/\//i.test(socialUrl) || socialUrl.length > 500)) || (imageData && !match)) {
    return response.status(400).json({ error: 'Check the title, owner, HTTPS social link, and photo format.' });
  }
  const imageBuffer = match ? Buffer.from(match[2], 'base64') : null;
  if (imageBuffer && (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024)) return response.status(413).json({ error: 'Build photo must be 5 MB or smaller.' });
  let newImagePath = null;
  try {
    const [existing] = await pool.execute('SELECT image_url FROM mechanic_builds WHERE id = ?', [id]);
    if (!existing.length) return response.status(404).json({ error: 'Featured build not found.' });
    let imageUrl = existing[0].image_url;
    if (match) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
      const fileName = `${crypto.randomUUID()}.${extension}`;
      newImagePath = path.join(uploadDirectory, fileName);
      await fs.promises.writeFile(newImagePath, imageBuffer, { flag: 'wx' });
      imageUrl = `/uploads/${fileName}`;
    }
    await pool.execute('UPDATE mechanic_builds SET title = ?, owner_name = ?, social_url = ?, image_url = ? WHERE id = ?', [title, ownerName, socialUrl || null, imageUrl, id]);
    if (newImagePath) await fs.promises.unlink(path.join(uploadDirectory, path.basename(existing[0].image_url))).catch(() => {});
    response.json({ message: 'Featured build saved.' });
  } catch (error) {
    if (newImagePath) await fs.promises.unlink(newImagePath).catch(() => {});
    next(error);
  }
});

app.delete('/api/admin/builds/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid build.' });
  try {
    const [rows] = await pool.execute('SELECT image_url FROM mechanic_builds WHERE id = ?', [id]);
    if (!rows.length) return response.status(404).json({ error: 'Build not found.' });
    await pool.execute('DELETE FROM mechanic_builds WHERE id = ?', [id]);
    const fileName = path.basename(rows[0].image_url);
    await fs.promises.unlink(path.join(uploadDirectory, fileName)).catch(() => {});
    response.json({ message: 'Build removed.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/certifications', requireAuth, requireAdmin, async (request, response, next) => {
  const body = String(request.body.body || '').trim();
  const title = String(request.body.title || '').trim();
  const year = String(request.body.year || '').trim();
  const match = String(request.body.imageData || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (body.length < 2 || body.length > 80 || title.length < 2 || title.length > 180 || year.length < 2 || year.length > 20 || !match) {
    return response.status(400).json({ error: 'Add the certificate provider, title, year, and a JPEG/PNG/WebP image.' });
  }
  const imageBuffer = Buffer.from(match[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) return response.status(413).json({ error: 'Certificate image must be 5 MB or smaller.' });
  try {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
    const fileName = `${crypto.randomUUID()}.${extension}`;
    await fs.promises.writeFile(path.join(uploadDirectory, fileName), imageBuffer, { flag: 'wx' });
    const imageUrl = `/uploads/${fileName}`;
    const [result] = await pool.execute('INSERT INTO mechanic_certifications (body, title, year, image_url) VALUES (?, ?, ?, ?)', [body, title, year, imageUrl]);
    response.status(201).json({ id: result.insertId, message: 'Certification added.' });
  } catch (error) { next(error); }
});

app.put('/api/admin/certifications/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const body = String(request.body.body || '').trim();
  const title = String(request.body.title || '').trim();
  const year = String(request.body.year || '').trim();
  const imageData = String(request.body.imageData || '');
  const match = imageData ? imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid certification.' });
  if (body.length < 2 || body.length > 80 || title.length < 2 || title.length > 180 || year.length < 2 || year.length > 20 || (imageData && !match)) {
    return response.status(400).json({ error: 'Check the provider, title, year, and image format.' });
  }
  const imageBuffer = match ? Buffer.from(match[2], 'base64') : null;
  if (imageBuffer && (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024)) return response.status(413).json({ error: 'Certificate image must be 5 MB or smaller.' });
  let newImagePath = null;
  try {
    const [existing] = await pool.execute('SELECT image_url FROM mechanic_certifications WHERE id = ?', [id]);
    if (!existing.length) return response.status(404).json({ error: 'Certification not found.' });
    let imageUrl = existing[0].image_url;
    if (match) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
      const fileName = `${crypto.randomUUID()}.${extension}`;
      newImagePath = path.join(uploadDirectory, fileName);
      await fs.promises.writeFile(newImagePath, imageBuffer, { flag: 'wx' });
      imageUrl = `/uploads/${fileName}`;
    }
    await pool.execute('UPDATE mechanic_certifications SET body = ?, title = ?, year = ?, image_url = ? WHERE id = ?', [body, title, year, imageUrl, id]);
    if (newImagePath) await fs.promises.unlink(path.join(uploadDirectory, path.basename(existing[0].image_url))).catch(() => {});
    response.json({ message: 'Certification saved.' });
  } catch (error) {
    if (newImagePath) await fs.promises.unlink(newImagePath).catch(() => {});
    next(error);
  }
});

app.delete('/api/admin/certifications/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid certification.' });
  try {
    const [rows] = await pool.execute('SELECT image_url FROM mechanic_certifications WHERE id = ?', [id]);
    if (!rows.length) return response.status(404).json({ error: 'Certification not found.' });
    await pool.execute('DELETE FROM mechanic_certifications WHERE id = ?', [id]);
    await fs.promises.unlink(path.join(uploadDirectory, path.basename(rows[0].image_url))).catch(() => {});
    response.json({ message: 'Certification removed.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/announcements', requireAuth, requireAdmin, async (request, response, next) => {
  const title = String(request.body.title || '').trim();
  const body = String(request.body.body || '').trim();
  const eventAt = request.body.eventAt ? new Date(request.body.eventAt) : null;
  if (title.length < 2 || title.length > 160 || body.length < 5 || body.length > 5000 || (eventAt && Number.isNaN(eventAt.getTime()))) {
    return response.status(400).json({ error: 'Enter an announcement title and details, with an optional valid event date.' });
  }
  try {
    const sqlEventAt = eventAt ? eventAt.toISOString().slice(0, 19).replace('T', ' ') : null;
    const [result] = await pool.execute('INSERT INTO announcements (title, body, event_at) VALUES (?, ?, ?)', [title, body, sqlEventAt]);
    response.status(201).json({ id: result.insertId, message: 'Announcement published to customer accounts.' });
  } catch (error) { next(error); }
});

app.delete('/api/admin/announcements/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid announcement.' });
  try {
    const [result] = await pool.execute('UPDATE announcements SET is_published = 0 WHERE id = ?', [id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Announcement not found.' });
    response.json({ message: 'Announcement unpublished.' });
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  console.error(error.code || error.message);
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return response.status(503).json({ error: 'Database schema is incomplete. From BACKEND, run npm run db:setup, then retry.' });
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(error.code)) {
    return response.status(503).json({ error: 'Cannot connect to MySQL. Check that MySQL is running and DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD in BACKEND/.env are correct.' });
  }
  response.status(500).json({ error: 'The request could not be completed. Check that the API and MySQL are configured.' });
});

module.exports = app;
