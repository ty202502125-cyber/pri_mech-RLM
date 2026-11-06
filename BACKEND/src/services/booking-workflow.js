const allowedTransitions = {
  pending_review: new Set(['awaiting_payment', 'awaiting_customer_response', 'awaiting_customer', 'rejected', 'cancelled']),
  awaiting_customer_response: new Set(['pending_review', 'awaiting_payment', 'rejected', 'cancelled']),
  awaiting_customer: new Set(['awaiting_payment', 'pending_review', 'cancelled']),
  rescheduled: new Set(['awaiting_payment', 'pending_review', 'cancelled']),
  awaiting_payment: new Set(['payment_submitted', 'payment_rejected', 'confirmed', 'cancelled']),
  payment_submitted: new Set(['confirmed', 'awaiting_payment', 'payment_rejected', 'cancelled']),
  payment_rejected: new Set(['awaiting_payment', 'payment_submitted', 'cancelled']),
  confirmed: new Set(['in_progress', 'cancelled', 'no_show']),
  in_progress: new Set(['completed', 'cancelled']),
  completed: new Set(),
  rejected: new Set(),
  cancelled: new Set(),
  no_show: new Set(),
};

const noticeForStatus = {
  pending_review: ['booking_update', 'Booking returned for review', 'Your booking request is back in the mechanic’s review queue.'],
  awaiting_customer_response: ['booking_question', 'More information requested', 'The mechanic has a question about your booking. Open it to review the note.'],
  awaiting_customer: ['reschedule_proposed', 'New appointment time proposed', 'The mechanic proposed a new appointment time. Please accept or decline it.'],
  awaiting_payment: ['payment_instructions', 'Booking approved — payment needed', 'Your booking is approved. Submit payment within two hours to keep the reservation.'],
  payment_submitted: ['payment_submitted', 'Payment submitted for review', 'Your payment proof was submitted for mechanic verification.'],
  payment_rejected: ['payment_rejected', 'Payment needs attention', 'The submitted payment was not verified. Review the reason and contact the mechanic.'],
  confirmed: ['booking_confirmed', 'Appointment confirmed', 'Your appointment has been confirmed.'],
  in_progress: ['repair_started', 'Repair started', 'Work on your bicycle has started.'],
  completed: ['repair_completed', 'Repair completed', 'Your repair has been marked complete.'],
  rejected: ['booking_rejected', 'Booking request declined', 'The mechanic declined your booking request.'],
  cancelled: ['booking_cancelled', 'Booking cancelled', 'Your booking has been cancelled.'],
  no_show: ['booking_no_show', 'Missed appointment recorded', 'The mechanic recorded this appointment as a no-show.'],
};

async function notify(connection, userId, type, title, body, bookingId) {
  await connection.execute(
    'INSERT INTO notifications (user_id, type, title, body, related_booking_id) VALUES (?, ?, ?, ?, ?)',
    [userId, type, title, body, bookingId || null],
  );
}

async function recordTransition(connection, { bookingId, from, to, actorId, actorRole, note }) {
  if (!allowedTransitions[from]?.has(to)) {
    const error = new Error(`Booking cannot move from ${from} to ${to}.`);
    error.statusCode = 409;
    throw error;
  }
  await connection.execute(
    'INSERT INTO booking_status_history (booking_id, previous_status, new_status, note, changed_by) VALUES (?, ?, ?, ?, ?)',
    [bookingId, from, to, note || null, actorId || null],
  );

  const [[booking]] = await connection.execute('SELECT customer_id FROM bookings WHERE id = ?', [bookingId]);
  const notice = noticeForStatus[to];
  if (booking && notice && actorRole !== 'customer') {
    await notify(connection, booking.customer_id, notice[0], notice[1], note || notice[2], bookingId);
  }
  if (actorRole === 'customer' && from !== to) {
    const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    for (const admin of admins) {
      await notify(connection, admin.id, 'customer_booking_update', 'Customer updated a booking', `Booking #${bookingId} was ${to}.`, bookingId);
    }
  }
  if (actorRole === 'admin') {
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [actorId, `booking.${to}`, 'booking', String(bookingId), JSON.stringify({ from, to, note: note || null })],
    );
  }
}

module.exports = { allowedTransitions, notify, recordTransition };
