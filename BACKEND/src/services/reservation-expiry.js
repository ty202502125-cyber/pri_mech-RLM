const { recordTransition } = require('./booking-workflow');

async function expirePaymentReservations(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [bookings] = await connection.execute(
      `SELECT b.id, b.customer_id, p.id AS payment_id
       FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.status = 'awaiting_payment'
         AND b.reservation_expires_at <= UTC_TIMESTAMP()
       FOR UPDATE`,
    );
    for (const booking of bookings) {
      await recordTransition(connection, {
        bookingId: booking.id,
        from: 'awaiting_payment',
        to: 'cancelled',
        actorRole: 'system',
        note: 'The two-hour payment window expired. The reserved capacity is available again.',
      });
      await connection.execute(
        "UPDATE bookings SET status = 'cancelled', reservation_expires_at = NULL WHERE id = ?",
        [booking.id],
      );
      if (booking.payment_id) {
        await connection.execute(
          "UPDATE payments SET status = 'expired' WHERE id = ? AND status = 'pending'",
          [booking.payment_id],
        );
      }
      await connection.execute(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details)
         VALUES ('booking.payment_reservation_expired', 'booking', ?, ?)`,
        [String(booking.id), JSON.stringify({ releasedCapacity: true })],
      );
    }
    await connection.commit();
    return bookings.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { expirePaymentReservations };
