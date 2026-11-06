const WORKSHOP_TIME_ZONE = process.env.WORKSHOP_TIME_ZONE || 'Asia/Manila';

function mysqlDateTime(value) {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function workshopParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKSHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function dateAtWorkshopTime(dateKey, minute) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const hour = Math.floor(minute / 60);
  const minutePart = minute % 60;
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minutePart);
  let timestamp = desiredWallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = workshopParts(new Date(timestamp));
    const representedWallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = representedWallTime - desiredWallTime;
    if (!correction) break;
    timestamp -= correction;
  }
  return new Date(timestamp);
}

function workshopDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = workshopParts(value instanceof Date ? value : new Date(value));
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function workshopDayOfWeek(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function minuteOfDay(value) {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function dateBounds(value) {
  const date = workshopDateKey(value);
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const nextKey = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`;
  return { start: dateAtWorkshopTime(date, 0), end: dateAtWorkshopTime(nextKey, 0), date };
}

async function dailyBookings(connection, date, excludeBookingId = null) {
  const { start, end } = dateBounds(date);
  const [rows] = await connection.execute(
    `SELECT b.id, b.scheduled_at, b.status,
       COALESCE(NULLIF((SELECT SUM(bs.duration_snapshot) FROM booking_services bs WHERE bs.booking_id = b.id), 0),
         s.estimated_minutes, 60) AS duration_minutes
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.scheduled_at >= ? AND b.scheduled_at < ?
       AND (b.id <> ? OR ? IS NULL)
       AND (b.status IN ('confirmed', 'in_progress', 'completed', 'payment_submitted')
         OR (b.status = 'awaiting_payment' AND b.reservation_expires_at > UTC_TIMESTAMP()))`,
    [mysqlDateTime(start), mysqlDateTime(end), excludeBookingId, excludeBookingId],
  );
  return rows;
}

async function capacityForDate(connection, date, { excludeBookingId = null } = {}) {
  const { start, end, date: dateKey } = dateBounds(date);
  const schedule = (await connection.execute(
    'SELECT day_of_week, is_working_day, opens_at, closes_at, break_starts_at, break_ends_at, slot_minutes, daily_capacity_minutes, max_dropoffs_per_slot FROM availability_schedules WHERE day_of_week = ?',
    [workshopDayOfWeek(dateKey)],
  ))[0][0];
  if (!schedule || !schedule.is_working_day || !schedule.opens_at || !schedule.closes_at) {
    return { date: dateKey, status: 'closed', dailyCapacityMinutes: 0, reservedMinutes: 0, remainingMinutes: 0, schedule: schedule || null };
  }

  const [closures] = await connection.execute(
    'SELECT id FROM unavailable_dates WHERE starts_at < ? AND ends_at > ? LIMIT 1',
    [mysqlDateTime(end), mysqlDateTime(start)],
  );
  if (closures.length) {
    return { date: dateKey, status: 'unavailable', dailyCapacityMinutes: Number(schedule.daily_capacity_minutes), reservedMinutes: 0, remainingMinutes: 0, schedule };
  }

  const bookings = await dailyBookings(connection, start, excludeBookingId);
  const reservedMinutes = bookings.reduce((total, booking) => total + Number(booking.duration_minutes), 0);
  const dailyCapacityMinutes = Number(schedule.daily_capacity_minutes);
  const remainingMinutes = Math.max(0, dailyCapacityMinutes - reservedMinutes);
  return {
    date: dateKey,
    status: remainingMinutes === 0 ? 'fully_booked' : reservedMinutes > 0 ? 'limited_availability' : 'available',
    dailyCapacityMinutes,
    reservedMinutes,
    remainingMinutes,
    schedule,
  };
}

async function slotCheck(connection, { startAt, durationMinutes, excludeBookingId = null, lockSchedule = false }) {
  const date = dateBounds(startAt);
  const suffix = lockSchedule ? ' FOR UPDATE' : '';
  const [schedules] = await connection.execute(
    `SELECT is_working_day, opens_at, closes_at, break_starts_at, break_ends_at,
       slot_minutes, daily_capacity_minutes, max_dropoffs_per_slot
     FROM availability_schedules WHERE day_of_week = ?${suffix}`,
    [workshopDayOfWeek(date.date)],
  );
  const schedule = schedules[0];
  if (!schedule || !schedule.is_working_day || !schedule.opens_at || !schedule.closes_at) {
    return { available: false, reason: 'The workshop is not open on that day.' };
  }

  const startParts = workshopParts(startAt);
  const startMinute = startParts.hour * 60 + startParts.minute;
  const openMinute = minuteOfDay(schedule.opens_at);
  const closeMinute = minuteOfDay(schedule.closes_at);
  if (startMinute < openMinute || startMinute >= closeMinute) {
    return { available: false, reason: 'The requested drop-off time falls outside workshop hours.' };
  }
  if ((startMinute - openMinute) % Number(schedule.slot_minutes) !== 0) {
    return { available: false, reason: 'Choose a drop-off time that matches the configured appointment interval.' };
  }
  if (schedule.break_starts_at && schedule.break_ends_at
      && startMinute >= minuteOfDay(schedule.break_starts_at)
      && startMinute < minuteOfDay(schedule.break_ends_at)) {
    return { available: false, reason: 'The requested drop-off time falls during the workshop break.' };
  }

  const [closures] = await connection.execute(
    'SELECT id FROM unavailable_dates WHERE starts_at <= ? AND ends_at > ? LIMIT 1',
    [mysqlDateTime(startAt), mysqlDateTime(startAt)],
  );
  if (closures.length) return { available: false, reason: 'The workshop is unavailable at that drop-off time.' };

  const slotStartMinute = openMinute + Math.floor((startMinute - openMinute) / Number(schedule.slot_minutes)) * Number(schedule.slot_minutes);
  const slotStart = dateAtWorkshopTime(date.date, slotStartMinute);
  const slotEnd = dateAtWorkshopTime(date.date, slotStartMinute + Number(schedule.slot_minutes));
  const [dropoffs] = await connection.execute(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE scheduled_at >= ? AND scheduled_at < ? AND (id <> ? OR ? IS NULL)
       AND (status IN ('confirmed', 'in_progress', 'completed', 'payment_submitted')
         OR (status = 'awaiting_payment' AND reservation_expires_at > UTC_TIMESTAMP()))`,
    [mysqlDateTime(slotStart), mysqlDateTime(slotEnd), excludeBookingId, excludeBookingId],
  );
  if (Number(dropoffs[0].count) >= Number(schedule.max_dropoffs_per_slot)) {
    return { available: false, reason: 'That drop-off time has reached its bicycle limit.' };
  }

  const capacity = await capacityForDate(connection, startAt, { excludeBookingId });
  if (capacity.status === 'unavailable' || capacity.status === 'closed') {
    return { available: false, reason: 'The workshop is unavailable on that date.' };
  }
  if (durationMinutes > capacity.remainingMinutes) {
    return { available: false, reason: `Only ${capacity.remainingMinutes} minutes of repair capacity remain on that date.` };
  }
  return { available: true, schedule, capacity };
}

async function serviceDuration(connection, serviceIds) {
  if (!serviceIds.length) return null;
  const placeholders = serviceIds.map(() => '?').join(', ');
  const [services] = await connection.execute(
    `SELECT id, estimated_minutes FROM services WHERE is_active = 1 AND id IN (${placeholders})`,
    serviceIds,
  );
  if (services.length !== serviceIds.length) return null;
  return services.reduce((total, service) => total + Number(service.estimated_minutes), 0);
}

module.exports = {
  WORKSHOP_TIME_ZONE,
  mysqlDateTime,
  dateBounds,
  dateAtWorkshopTime,
  workshopDateKey,
  capacityForDate,
  slotCheck,
  serviceDuration,
};
