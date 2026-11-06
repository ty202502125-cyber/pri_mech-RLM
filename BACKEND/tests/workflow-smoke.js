const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const app = require('../src/app');
const pool = require('../src/config/db');
const { capacityForDate, dateAtWorkshopTime, slotCheck, workshopDateKey } = require('../src/services/availability');
const { parseBicyclePhotoDataUrl, MAX_PHOTO_BYTES } = require('../src/services/bicycle-photos');

async function checkDailyCapacityMath() {
  const schedule = {
    day_of_week: 1,
    is_working_day: 1,
    opens_at: '10:00',
    closes_at: '20:00',
    break_starts_at: null,
    break_ends_at: null,
    slot_minutes: 60,
    daily_capacity_minutes: 600,
    max_dropoffs_per_slot: 1,
  };
  const connection = {
    async execute(query) {
      if (query.includes('FROM availability_schedules')) return [[schedule], []];
      if (query.includes('FROM unavailable_dates')) return [[], []];
      if (query.includes('COUNT(*) AS count')) return [[{ count: 0 }], []];
      if (query.includes('FROM bookings b JOIN services s')) {
        return [[{ duration_minutes: 240 }, { duration_minutes: 240 }], []];
      }
      throw new Error(`Unexpected capacity test query: ${query}`);
    },
  };
  const startAt = dateAtWorkshopTime('2026-11-09', 10 * 60);
  const capacity = await capacityForDate(connection, startAt);
  assert.equal(capacity.dailyCapacityMinutes, 600);
  assert.equal(capacity.reservedMinutes, 480);
  assert.equal(capacity.remainingMinutes, 120);
  const twoHourRequest = await slotCheck(connection, { startAt, durationMinutes: 120 });
  assert.equal(twoHourRequest.available, true);
  const fourHourRequest = await slotCheck(connection, { startAt, durationMinutes: 240 });
  assert.equal(fourHourRequest.available, false);
}

function checkBicyclePhotoSizeLimit() {
  const exactLimit = Buffer.alloc(MAX_PHOTO_BYTES);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(exactLimit);
  const accepted = parseBicyclePhotoDataUrl(`data:image/png;base64,${exactLimit.toString('base64')}`);
  assert.equal(accepted?.buffer.length, MAX_PHOTO_BYTES);
  const oversized = Buffer.concat([exactLimit, Buffer.alloc(1)]);
  assert.equal(parseBicyclePhotoDataUrl(`data:image/png;base64,${oversized.toString('base64')}`), null);
}

async function main() {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let userId;
  const bookingIds = [];
  const proofFiles = [];
  const bicyclePhotoFiles = [];
  const groupIds = [];
  const groupPaymentIds = [];
  let bicycleId;
  let paymentId;
  let adminUserId;
  let scheduleAuditId;
  let workshopAddressAuditId;
  let previousWorkshopAddress;
  let previousSchedule;
  let testWeekday;
  let cookie;
  try {
    const health = await fetch(`${base}/health`);
    const healthBody = await health.json();
    if (health.status !== 200 || healthBody.schema !== 'ready') {
      throw new Error(`The API health check did not confirm the workflow schema is ready: ${JSON.stringify(healthBody)}`);
    }
    await checkDailyCapacityMath();
    checkBicyclePhotoSizeLimit();
    const [services] = await pool.execute('SELECT id, starting_price FROM services WHERE is_active = 1 ORDER BY id LIMIT 1');
    if (!services.length) throw new Error('No active service is available for the workflow smoke check.');
    const email = `workflow-smoke-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;
    const password = `smoke-${crypto.randomBytes(12).toString('hex')}`;

    const register = await fetch(`${base}/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Workflow Smoke Test', email, password }),
    });
    if (register.status !== 201) throw new Error(`Registration returned ${register.status}: ${await register.text()}`);
    const registered = await register.json();
    userId = registered.user.id;
    if (registered.user.role !== 'customer') throw new Error('Public registration assigned a privileged role.');

    const login = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (login.status !== 200) throw new Error(`Login returned ${login.status}: ${await login.text()}`);
    cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!cookie?.startsWith('session=')) throw new Error('Login did not issue the HTTP-only session cookie.');

    const me = await fetch(`${base}/auth/me`, { headers: { cookie } });
    if (me.status !== 200 || (await me.json()).user.id !== userId) throw new Error('Authenticated session did not resolve to the registered customer.');

    const profile = await fetch(`${base}/customers/me`, { headers: { cookie } });
    if (profile.status !== 200) throw new Error('Customer profile could not be loaded.');
    const profileUpdate = await fetch(`${base}/customers/me`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fullName: 'Workflow Smoke Test', phone: '09170000000', address: 'Test address' }),
    });
    if (profileUpdate.status !== 200) throw new Error('Customer profile could not be updated.');
    const bikeResponse = await fetch(`${base}/bicycles`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brand: 'Smoke', model: 'Test', category: 'Road bike', frameDetails: '54 cm' }),
    });
    if (bikeResponse.status !== 201) throw new Error(`Bicycle creation returned ${bikeResponse.status}.`);
    bicycleId = (await bikeResponse.json()).bicycle.id;

    const adminLogin = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    if (adminLogin.status !== 200) throw new Error('The configured administrator credentials cannot log in.');
    const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0];
    adminUserId = (await adminLogin.json()).user.id;
    const [[savedAddress]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'workshop_address'");
    previousWorkshopAddress = savedAddress?.setting_value ?? null;
    const setAddress = await fetch(`${base}/admin/workshop-location`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ address: 'Workflow smoke test private workshop address' }),
    });
    if (setAddress.status !== 200) throw new Error(`Private workshop address setup returned ${setAddress.status}: ${await setAddress.text()}`);
    const [[addressAudit]] = await pool.execute(
      "SELECT id FROM audit_logs WHERE actor_user_id = ? AND action = 'workshop.location_updated' ORDER BY id DESC LIMIT 1",
      [adminUserId],
    );
    workshopAddressAuditId = addressAudit?.id;

    let appointmentDate = workshopDateKey(new Date(Date.now() + 20 * 86400000));
    testWeekday = new Date(`${appointmentDate}T12:00:00Z`).getUTCDay();
    const [[existingSchedule]] = await pool.execute('SELECT * FROM availability_schedules WHERE day_of_week = ?', [testWeekday]);
    previousSchedule = existingSchedule;
    const scheduleSave = await fetch(`${base}/admin/availability/schedules/${testWeekday}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ isWorkingDay: true, opensAt: '09:00', closesAt: '17:00', breakStartsAt: '12:00', breakEndsAt: '13:00', slotMinutes: 30, dailyCapacityMinutes: 420, maxDropoffsPerSlot: 1 }),
    });
    if (scheduleSave.status !== 200) throw new Error(`Schedule update returned ${scheduleSave.status}: ${await scheduleSave.text()}`);
    const [[scheduleAudit]] = await pool.execute(
      "SELECT id FROM audit_logs WHERE actor_user_id = ? AND action = 'availability.schedule_updated' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [adminUserId, String(testWeekday)],
    );
    scheduleAuditId = scheduleAudit?.id;

    let candidateSlots = [];
    for (let week = 0; week < 12; week += 1) {
      const availability = await fetch(`${base}/availability?date=${appointmentDate}&serviceId=${services[0].id}`);
      const availabilityJson = await availability.json();
      if (availability.status === 200 && availabilityJson.slots.length >= 4) {
        candidateSlots = availabilityJson.slots.map(slot => new Date(slot.startsAt));
        break;
      }
      const nextDate = new Date(`${appointmentDate}T12:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 7);
      appointmentDate = workshopDateKey(nextDate);
    }
    if (candidateSlots.length < 4) throw new Error('Could not find a future work date with four available drop-off slots for the smoke test.');
    const appointmentTime = candidateSlots[0];
    const repairTime = candidateSlots[1];
    const cancellationTime = candidateSlots[2];
    const concurrentAt = candidateSlots[3];

    const makeBooking = async (problem, preferredAt = appointmentTime, selectedBicycleId = bicycleId) => {
      const create = await fetch(`${base}/bookings`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ serviceIds: [services[0].id], bicycleId: selectedBicycleId, bicycleType: 'Road bike', problem, preferredAt: preferredAt.toISOString() }),
      });
      if (create.status !== 201) throw new Error(`Booking creation returned ${create.status}: ${await create.text()}`);
      const created = await create.json();
      bookingIds.push(created.booking.id);
      return created.booking.id;
    };
    const bookingId = await makeBooking('Workflow smoke test repair lifecycle');

    const [history] = await pool.execute('SELECT new_status FROM booking_status_history WHERE booking_id = ? ORDER BY id', [bookingId]);
    const [snapshots] = await pool.execute('SELECT service_name_snapshot, unit_price_snapshot, duration_snapshot FROM booking_services WHERE booking_id = ?', [bookingId]);
    if (history.length !== 1 || history[0].new_status !== 'pending_review') throw new Error('Initial booking status history was not recorded.');
    if (snapshots.length !== 1 || !snapshots[0].service_name_snapshot) throw new Error('Service price/duration snapshot was not recorded.');
    const [[bikeLink]] = await pool.execute('SELECT bicycle_id, bicycle_brand FROM bookings WHERE id = ?', [bookingId]);
    if (Number(bikeLink.bicycle_id) !== bicycleId || bikeLink.bicycle_brand !== 'Smoke') throw new Error('Booking did not preserve the selected customer bicycle.');

    const invalidTransition = await fetch(`${base}/admin/bookings/${bookingId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ status: 'completed' }),
    });
    if (invalidTransition.status !== 403) throw new Error(`Customer admin access check returned ${invalidTransition.status}.`);

    const approveAndPay = async (id, appointment, amount) => {
      const approve = await fetch(`${base}/admin/bookings/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ status: 'awaiting_payment', scheduledAt: appointment.toISOString(), adminNote: 'Approved for payment' }),
      });
      if (approve.status !== 200) throw new Error(`Booking approval returned ${approve.status}: ${await approve.text()}`);
      const submit = await fetch(`${base}/payments`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          bookingId: id, amount, method: 'gcash', transactionRef: `SMOKE-${crypto.randomUUID()}`,
          proofData: 'data:application/pdf;base64,JVBERi0xLjQK',
        }),
      });
      if (submit.status !== 201) throw new Error(`Payment submission returned ${submit.status}: ${await submit.text()}`);
      const transaction = await submit.json();
      const [[proof]] = await pool.execute('SELECT proof_path FROM payment_transactions WHERE id = ?', [transaction.id]);
      proofFiles.push(path.resolve(__dirname, '../private-uploads/payment-proofs', proof.proof_path));
      const verified = await fetch(`${base}/payments/transactions/${transaction.id}/verify`, {
        method: 'PATCH', headers: { cookie: adminCookie },
      });
      if (verified.status !== 200 || (await verified.json()).paymentStatus !== 'paid') {
        throw new Error('Mechanic verification did not confirm the paid booking.');
      }
    };

    const date = appointmentDate;
    const availability = await fetch(`${base}/availability?date=${date}&serviceId=${services[0].id}`);
    const availabilityJson = await availability.json();
    if (availability.status !== 200 || !availabilityJson.slots.some(slot => slot.startsAt === appointmentTime.toISOString())) {
      throw new Error('Configured availability did not expose the expected appointment slot.');
    }
    const hiddenLocation = await fetch(`${base}/bookings/${bookingId}/location`, { headers: { cookie } });
    if (hiddenLocation.status !== 403) throw new Error('Workshop address was exposed before payment verification.');

    const invalidAdminTransition = await fetch(`${base}/admin/bookings/${bookingId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ status: 'completed' }),
    });
    if (invalidAdminTransition.status !== 409) throw new Error(`Invalid booking transition returned ${invalidAdminTransition.status}, expected 409.`);

    await approveAndPay(bookingId, appointmentTime, Number(services[0].starting_price));
    const releasedLocation = await fetch(`${base}/bookings/${bookingId}/location`, { headers: { cookie } });
    if (releasedLocation.status !== 200 || (await releasedLocation.json()).address !== 'Workflow smoke test private workshop address') {
      throw new Error('Verified payment did not release the private workshop address to the booking owner.');
    }
    for (const status of ['in_progress', 'completed']) {
      const update = await fetch(`${base}/admin/bookings/${bookingId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ status, adminNote: 'Workflow smoke test' }),
      });
      if (update.status !== 200) throw new Error(`Admin transition to ${status} returned ${update.status}: ${await update.text()}`);
    }
    const [lifecycle] = await pool.execute('SELECT new_status FROM booking_status_history WHERE booking_id = ? ORDER BY id', [bookingId]);
    if (lifecycle.map(row => row.new_status).join(',') !== 'pending_review,awaiting_payment,payment_submitted,confirmed,in_progress,completed') throw new Error('The repair lifecycle history is incomplete.');

    const repairBooking = await makeBooking('Workflow smoke test repair record', repairTime);
    await approveAndPay(repairBooking, repairTime, Number(services[0].starting_price));
    for (const status of ['in_progress']) {
      const update = await fetch(`${base}/admin/bookings/${repairBooking}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ status, adminNote: 'Repair flow setup' }),
      });
      if (update.status !== 200) throw new Error(`Repair setup transition ${status} returned ${update.status}: ${await update.text()}`);
    }
    const repairCreate = await fetch(`${base}/repairs/${repairBooking}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ inspectionNotes: 'Initial inspection' }),
    });
    if (repairCreate.status !== 201) throw new Error(`Repair record creation returned ${repairCreate.status}: ${await repairCreate.text()}`);
    const repairId = (await repairCreate.json()).id;
    let repairUpdate = await fetch(`${base}/repairs/${repairId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ status: 'inspection' }),
    });
    if (repairUpdate.status !== 200) throw new Error('Repair could not enter inspection.');
    repairUpdate = await fetch(`${base}/repairs/${repairId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ estimateAmount: Number(services[0].starting_price) + 100, inspectionNotes: 'Inspection complete', parts: [{ name: 'Brake cable', quantity: 1, unitCost: 120 }] }),
    });
    if (repairUpdate.status !== 200) throw new Error(`Repair estimate returned ${repairUpdate.status}: ${await repairUpdate.text()}`);
    const approveEstimate = await fetch(`${base}/repairs/${repairId}/estimate`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ decision: 'approved' }),
    });
    if (approveEstimate.status !== 200) throw new Error(`Customer estimate approval returned ${approveEstimate.status}: ${await approveEstimate.text()}`);
    for (const status of ['quality_check', 'ready_for_pickup']) {
      repairUpdate = await fetch(`${base}/repairs/${repairId}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ status, parts: [] }),
      });
      if (repairUpdate.status !== 200) throw new Error(`Repair transition ${status} returned ${repairUpdate.status}: ${await repairUpdate.text()}`);
    }
    repairUpdate = await fetch(`${base}/repairs/${repairId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ status: 'completed', finalAmount: Number(services[0].starting_price) + 50, completionNotes: 'Repair completed successfully', warrantyUntil: '2027-01-01' }),
    });
    if (repairUpdate.status !== 200) throw new Error(`Repair completion returned ${repairUpdate.status}: ${await repairUpdate.text()}`);

    const proofData = 'data:application/pdf;base64,JVBERi0xLjQK';
    const paymentCreate = await fetch(`${base}/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ bookingId: repairBooking, amount: 50, method: 'gcash', transactionRef: `SMOKE-${crypto.randomUUID()}`, proofData }),
    });
    if (paymentCreate.status !== 201) throw new Error(`Payment submission returned ${paymentCreate.status}: ${await paymentCreate.text()}`);
    const payment = await paymentCreate.json(); paymentId = payment.id;
    const [[paymentRow]] = await pool.execute(
      `SELECT pt.status, pt.proof_path, p.status AS payment_status FROM payment_transactions pt JOIN payments p ON p.id = pt.payment_id WHERE pt.id = ?`,
      [paymentId],
    );
    proofFiles.push(path.resolve(__dirname, '../private-uploads/payment-proofs', paymentRow.proof_path));
    if (paymentRow.status !== 'submitted' || paymentRow.payment_status !== 'partially_paid') throw new Error('The remaining payment was not kept pending against the partially paid balance.');
    const proofAccess = await fetch(`${base}/payments/transactions/${paymentId}/proof`, { headers: { cookie } });
    if (proofAccess.status !== 200 || proofAccess.headers.get('content-type') !== 'application/pdf') throw new Error('Customer could not access their private payment proof.');
    const verifyPayment = await fetch(`${base}/payments/transactions/${paymentId}/verify`, { method: 'PATCH', headers: { cookie: adminCookie } });
    if (verifyPayment.status !== 200 || (await verifyPayment.json()).paymentStatus !== 'paid') throw new Error('Mechanic verification did not update the payment balance.');
    const refund = await fetch(`${base}/payments/transactions/${paymentId}/refund`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ note: 'Smoke test full refund' }),
    });
    if (refund.status !== 200 || (await refund.json()).paymentStatus !== 'partially_paid') throw new Error('Refunding one transaction should leave the earlier verified payment balance recorded.');

    const cancellationBooking = await makeBooking('Workflow smoke test cancellation', cancellationTime);
    const cancel = await fetch(`${base}/bookings/${cancellationBooking}/cancel`, { method: 'PATCH', headers: { cookie } });
    if (cancel.status !== 200) throw new Error(`Customer cancellation returned ${cancel.status}: ${await cancel.text()}`);
    const [finalHistory] = await pool.execute('SELECT new_status FROM booking_status_history WHERE booking_id = ? ORDER BY id', [cancellationBooking]);
    if (finalHistory.length !== 2 || finalHistory[1].new_status !== 'cancelled') throw new Error('Cancellation history was not recorded.');

    const contenderA = await makeBooking('Workflow smoke test concurrency A', concurrentAt);
    const contenderB = await makeBooking('Workflow smoke test concurrency B', concurrentAt);
    const confirmationResults = await Promise.all([contenderA, contenderB].map(id => fetch(`${base}/admin/bookings/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ status: 'awaiting_payment', scheduledAt: concurrentAt.toISOString(), adminNote: 'Concurrent drop-off limit check' }),
    })));
    const responseCodes = confirmationResults.map(result => result.status).sort();
    if (responseCodes[0] !== 200 || responseCodes[1] !== 409) throw new Error(`Concurrent drop-off approvals returned ${responseCodes.join(', ')} instead of 200, 409.`);
    const postConfirmAvailability = await fetch(`${base}/availability?date=${date}&serviceId=${services[0].id}`);
    if ((await postConfirmAvailability.json()).slots.some(slot => slot.startsAt === appointmentTime.toISOString())) {
      throw new Error('The availability endpoint still offered an occupied slot.');
    }

    const groupSlots = [new Date(appointmentTime.getTime() + 7 * 86400000), new Date(repairTime.getTime() + 7 * 86400000)];
    const grouped = await fetch(`${base}/booking-groups`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        paymentChoice: 'together',
        bikes: [
          { bicycleId, serviceIds: [services[0].id], problem: 'Grouped request road bicycle repair', preferredAt: groupSlots[0].toISOString() },
          { bicycleType: 'Mountain bike', brand: 'Smoke', model: 'MTB', serviceIds: [services[0].id], problem: 'Grouped request mountain bicycle repair', preferredAt: groupSlots[1].toISOString() },
        ],
      }),
    });
    if (grouped.status !== 201) throw new Error(`Grouped booking creation returned ${grouped.status}: ${await grouped.text()}`);
    const groupData = await grouped.json();
    groupIds.push(groupData.group.id);
    bookingIds.push(...groupData.bookings.map(booking => booking.id));
    if (groupData.bookings.length !== 2 || groupData.group.paymentChoice !== 'together') throw new Error('Grouped booking did not preserve the two-bike payment choice.');
    const [[groupRow]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM bookings WHERE booking_group_id = ?',
      [groupData.group.id],
    );
    if (Number(groupRow.count) !== 2) throw new Error('The booking group did not link both bicycle requests.');

    const samplePhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ2QAAAAASUVORK5CYII=';
    const firstGroupedBooking = groupData.bookings[0];
    for (let index = 0; index < 3; index += 1) {
      const upload = await fetch(`${base}/bookings/${firstGroupedBooking.id}/photos`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ photoData: samplePhoto }),
      });
      if (upload.status !== 201) throw new Error(`Bicycle photo upload returned ${upload.status}: ${await upload.text()}`);
    }
    const excessPhoto = await fetch(`${base}/bookings/${firstGroupedBooking.id}/photos`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ photoData: samplePhoto }),
    });
    if (excessPhoto.status !== 409) throw new Error('A fourth bicycle photo should be rejected.');
    const photoList = await fetch(`${base}/bookings/${firstGroupedBooking.id}/photos`, { headers: { cookie } });
    const photoListData = await photoList.json();
    if (photoList.status !== 200 || photoListData.photos.length !== 3) throw new Error('The owner could not retrieve the three private bicycle photos.');
    const photoAccess = await fetch(`${base}/booking-photos/${photoListData.photos[0].id}`, { headers: { cookie } });
    if (photoAccess.status !== 200 || photoAccess.headers.get('content-type') !== 'image/png') throw new Error('The owner could not access a private bicycle photo.');
    const privatePhotoAccess = await fetch(`${base}/booking-photos/${photoListData.photos[0].id}`);
    if (privatePhotoAccess.status !== 401) throw new Error('Bicycle photos must not be accessible without authentication.');
    const [savedPhotos] = await pool.execute('SELECT file_name FROM booking_photos WHERE booking_id = ?', [firstGroupedBooking.id]);
    bicyclePhotoFiles.push(...savedPhotos.map(photo => path.resolve(__dirname, '../private-uploads/bicycle-photos', photo.file_name)));

    for (let index = 0; index < groupData.bookings.length; index += 1) {
      const approve = await fetch(`${base}/admin/bookings/${groupData.bookings[index].id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ status: 'awaiting_payment', scheduledAt: groupSlots[index].toISOString() }),
      });
      if (approve.status !== 200) throw new Error(`Grouped booking approval returned ${approve.status}: ${await approve.text()}`);
    }
    const [groupPayments] = await pool.execute(
      `SELECT p.estimated_amount, p.final_amount FROM payments p
       JOIN bookings b ON b.id = p.booking_id WHERE b.booking_group_id = ?`,
      [groupData.group.id],
    );
    const groupAmount = groupPayments.reduce((total, payment) => total + Number(payment.final_amount ?? payment.estimated_amount ?? 0), 0);
    const groupPaymentResponse = await fetch(`${base}/booking-groups/${groupData.group.id}/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        amount: groupAmount, method: 'gcash', transactionRef: `GROUP-SMOKE-${crypto.randomUUID()}`,
        proofData: 'data:application/pdf;base64,JVBERi0xLjQK',
      }),
    });
    if (groupPaymentResponse.status !== 201) throw new Error(`Combined payment submission returned ${groupPaymentResponse.status}: ${await groupPaymentResponse.text()}`);
    const groupPayment = await groupPaymentResponse.json();
    groupPaymentIds.push(groupPayment.id);
    const [[groupProof]] = await pool.execute('SELECT proof_path FROM booking_group_payments WHERE id = ?', [groupPayment.id]);
    proofFiles.push(path.resolve(__dirname, '../private-uploads/payment-proofs', groupProof.proof_path));
    const groupPaymentAdmin = await fetch(`${base}/booking-group-payments`, { headers: { cookie: adminCookie } });
    const groupPaymentAdminData = await groupPaymentAdmin.json();
    if (groupPaymentAdmin.status !== 200 || !groupPaymentAdminData.submissions.some(item => item.id === groupPayment.id)) {
      throw new Error('The mechanic payment queue did not include the combined group payment.');
    }
    const groupVerified = await fetch(`${base}/booking-group-payments/${groupPayment.id}/verify`, {
      method: 'PATCH', headers: { cookie: adminCookie },
    });
    if (groupVerified.status !== 200) throw new Error(`Combined payment verification returned ${groupVerified.status}: ${await groupVerified.text()}`);
    const [verifiedGroupBookings] = await pool.execute(
      `SELECT b.status, p.status AS payment_status FROM bookings b
       JOIN payments p ON p.booking_id = b.id WHERE b.booking_group_id = ?`,
      [groupData.group.id],
    );
    if (verifiedGroupBookings.length !== 2 || verifiedGroupBookings.some(item => item.status !== 'confirmed' || item.payment_status !== 'paid')) {
      throw new Error('Combined payment did not fully pay and confirm both bicycle appointments.');
    }

    const separateSlots = [new Date(appointmentTime.getTime() + 14 * 86400000), new Date(repairTime.getTime() + 14 * 86400000)];
    const separateGroupResponse = await fetch(`${base}/booking-groups`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        paymentChoice: 'separate',
        bikes: [
          { bicycleId, serviceIds: [services[0].id], problem: 'Separate payment road bicycle repair', preferredAt: separateSlots[0].toISOString() },
          { bicycleType: 'Mountain bike', serviceIds: [services[0].id], problem: 'Separate payment mountain bicycle repair', preferredAt: separateSlots[1].toISOString() },
        ],
      }),
    });
    if (separateGroupResponse.status !== 201) throw new Error(`Separate-payment booking creation returned ${separateGroupResponse.status}: ${await separateGroupResponse.text()}`);
    const separateGroup = await separateGroupResponse.json();
    groupIds.push(separateGroup.group.id);
    bookingIds.push(...separateGroup.bookings.map(booking => booking.id));
    const invalidCombinedPayment = await fetch(`${base}/booking-groups/${separateGroup.group.id}/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ amount: 1, method: 'gcash', transactionRef: `INVALID-GROUP-${crypto.randomUUID()}`, proofData: 'data:application/pdf;base64,JVBERi0xLjQK' }),
    });
    if (invalidCombinedPayment.status !== 409) throw new Error('Separate-payment groups must not accept a combined payment.');
    for (let index = 0; index < separateGroup.bookings.length; index += 1) {
      const booking = separateGroup.bookings[index];
      const approve = await fetch(`${base}/admin/bookings/${booking.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ status: 'awaiting_payment', scheduledAt: separateSlots[index].toISOString() }),
      });
      if (approve.status !== 200) throw new Error(`Separate-payment booking approval returned ${approve.status}: ${await approve.text()}`);
      const [[payment]] = await pool.execute('SELECT id, estimated_amount FROM payments WHERE booking_id = ?', [booking.id]);
      const paymentResponse = await fetch(`${base}/payments`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          bookingId: booking.id, amount: Number(payment.estimated_amount), method: 'gcash',
          transactionRef: `SEPARATE-SMOKE-${crypto.randomUUID()}`, proofData: 'data:application/pdf;base64,JVBERi0xLjQK',
        }),
      });
      if (paymentResponse.status !== 201) throw new Error(`Per-bicycle payment submission returned ${paymentResponse.status}: ${await paymentResponse.text()}`);
      const transaction = await paymentResponse.json();
      const [[proof]] = await pool.execute('SELECT proof_path FROM payment_transactions WHERE id = ?', [transaction.id]);
      proofFiles.push(path.resolve(__dirname, '../private-uploads/payment-proofs', proof.proof_path));
      const verified = await fetch(`${base}/payments/transactions/${transaction.id}/verify`, {
        method: 'PATCH', headers: { cookie: adminCookie },
      });
      if (verified.status !== 200) throw new Error(`Per-bicycle payment verification returned ${verified.status}: ${await verified.text()}`);
    }

    console.log('PASS existing workflows plus grouped bicycles, per-bike scheduling, private photo limits/access, combined and separate payments, and address access.');
  } finally {
    try {
      for (const bookingId of bookingIds) {
        await pool.execute('DELETE FROM notifications WHERE related_booking_id = ?', [bookingId]);
        await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'booking' AND entity_id = ?", [String(bookingId)]);
        const [repairs] = await pool.execute('SELECT id FROM repair_records WHERE booking_id = ?', [bookingId]);
        for (const repair of repairs) await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'repair' AND entity_id = ?", [String(repair.id)]);
        const [payments] = await pool.execute('SELECT id FROM payments WHERE booking_id = ?', [bookingId]);
        for (const payment of payments) {
          const [transactions] = await pool.execute('SELECT id FROM payment_transactions WHERE payment_id = ?', [payment.id]);
          for (const transaction of transactions) await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'payment_transaction' AND entity_id = ?", [String(transaction.id)]);
          await pool.execute('DELETE FROM payment_transactions WHERE payment_id = ?', [payment.id]);
        }
        await pool.execute('DELETE FROM payments WHERE booking_id = ?', [bookingId]);
        await pool.execute('DELETE FROM repair_records WHERE booking_id = ?', [bookingId]);
        await pool.execute('DELETE FROM bookings WHERE id = ?', [bookingId]);
      }
      for (const groupPaymentId of groupPaymentIds) {
        await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'booking_group_payment' AND entity_id = ?", [String(groupPaymentId)]);
      }
      for (const groupId of groupIds) {
        await pool.execute('DELETE FROM booking_group_payments WHERE group_id = ?', [groupId]);
        await pool.execute('DELETE FROM booking_groups WHERE id = ?', [groupId]);
      }
      for (const proofPath of proofFiles) await fs.unlink(proofPath).catch(() => {});
      for (const photoPath of bicyclePhotoFiles) await fs.unlink(photoPath).catch(() => {});
      if (userId && bicycleId) await pool.execute('DELETE FROM bicycles WHERE id = ? AND customer_id = ?', [bicycleId, userId]);
      if (previousSchedule) {
        await pool.execute(
          `UPDATE availability_schedules SET is_working_day = ?, opens_at = ?, closes_at = ?, break_starts_at = ?, break_ends_at = ?, slot_minutes = ?, daily_capacity_minutes = ?, max_dropoffs_per_slot = ? WHERE day_of_week = ?`,
          [previousSchedule.is_working_day, previousSchedule.opens_at, previousSchedule.closes_at, previousSchedule.break_starts_at, previousSchedule.break_ends_at, previousSchedule.slot_minutes, previousSchedule.daily_capacity_minutes, previousSchedule.max_dropoffs_per_slot, testWeekday],
        );
      }
      if (scheduleAuditId) await pool.execute('DELETE FROM audit_logs WHERE id = ?', [scheduleAuditId]);
      if (workshopAddressAuditId) await pool.execute('DELETE FROM audit_logs WHERE id = ?', [workshopAddressAuditId]);
      if (previousWorkshopAddress !== undefined) {
        if (previousWorkshopAddress === null) {
          await pool.execute("DELETE FROM app_settings WHERE setting_key = 'workshop_address'");
        } else {
          await pool.execute(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ('workshop_address', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [previousWorkshopAddress],
          );
        }
      }
      if (adminUserId && bookingIds.length) {
      const placeholders = bookingIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM audit_logs WHERE actor_user_id = ? AND entity_type = ? AND entity_id IN (${placeholders})`, [adminUserId, 'booking', ...bookingIds.map(String)]);
    }
      if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await pool.end();
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
