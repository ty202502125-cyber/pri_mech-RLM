<?php

namespace App\Services;

use DomainException;
use Illuminate\Support\Facades\DB;

class BookingWorkflowService
{
    private const TRANSITIONS = [
        'pending_review' => ['awaiting_payment', 'awaiting_customer_response', 'awaiting_customer', 'rejected', 'cancelled'],
        'awaiting_customer_response' => ['pending_review', 'awaiting_payment', 'rejected', 'cancelled'],
        'awaiting_customer' => ['awaiting_payment', 'pending_review', 'cancelled'],
        'rescheduled' => ['awaiting_payment', 'pending_review', 'cancelled'],
        'awaiting_payment' => ['payment_submitted', 'payment_rejected', 'confirmed', 'cancelled'],
        'payment_submitted' => ['confirmed', 'awaiting_payment', 'payment_rejected', 'cancelled'],
        'payment_rejected' => ['awaiting_payment', 'payment_submitted', 'cancelled'],
        'confirmed' => ['in_progress', 'cancelled', 'no_show'],
        'in_progress' => ['completed', 'cancelled'],
        'completed' => [],
        'rejected' => [],
        'cancelled' => [],
        'no_show' => [],
    ];

    private const NOTICES = [
        'pending_review' => ['booking_update', 'Booking returned for review', 'Your booking request is back in the mechanic’s review queue.'],
        'awaiting_customer_response' => ['booking_question', 'More information requested', 'The mechanic has a question about your booking. Open it to review the note.'],
        'awaiting_customer' => ['reschedule_proposed', 'New appointment time proposed', 'The mechanic proposed a new appointment time. Please accept or decline it.'],
        'awaiting_payment' => ['payment_instructions', 'Booking approved — payment needed', 'Your booking is approved. Submit payment within two hours to keep the reservation.'],
        'payment_submitted' => ['payment_submitted', 'Payment submitted for review', 'Your payment proof was submitted for mechanic verification.'],
        'payment_rejected' => ['payment_rejected', 'Payment needs attention', 'The submitted payment was not verified. Review the reason and contact the mechanic.'],
        'confirmed' => ['booking_confirmed', 'Appointment confirmed', 'Your appointment has been confirmed.'],
        'in_progress' => ['repair_started', 'Repair started', 'Work on your bicycle has started.'],
        'completed' => ['repair_completed', 'Repair completed', 'Your repair has been marked complete.'],
        'rejected' => ['booking_rejected', 'Booking request declined', 'The mechanic declined your booking request.'],
        'cancelled' => ['booking_cancelled', 'Booking cancelled', 'Your booking has been cancelled.'],
        'no_show' => ['booking_no_show', 'Missed appointment recorded', 'The mechanic recorded this appointment as a no-show.'],
    ];

    public function recordTransition(
        int $bookingId,
        ?string $from,
        string $to,
        ?int $actorId,
        string $actorRole,
        ?string $note = null,
    ): void {
        if ($from !== null && ! in_array($to, self::TRANSITIONS[$from] ?? [], true)) {
            throw new DomainException("Booking cannot move from {$from} to {$to}.", 409);
        }

        DB::table('booking_status_history')->insert([
            'booking_id' => $bookingId,
            'previous_status' => $from,
            'new_status' => $to,
            'note' => $note,
            'changed_by' => $actorId,
            'created_at' => now('UTC'),
        ]);

        $booking = DB::table('bookings')->where('id', $bookingId)->first(['customer_id']);
        $notice = self::NOTICES[$to] ?? null;

        if ($booking && $notice && $actorRole !== 'customer') {
            $this->notify((int) $booking->customer_id, $notice[0], $notice[1], $note ?: $notice[2], $bookingId);
        }

        if ($actorRole === 'customer' && $from !== $to) {
            $admins = DB::table('users')->where('role', 'admin')->where('is_active', 1)->pluck('id');

            foreach ($admins as $adminId) {
                $this->notify((int) $adminId, 'customer_booking_update', 'Customer updated a booking', "Booking #{$bookingId} was {$to}.", $bookingId);
            }
        }

        if ($actorRole === 'admin') {
            DB::table('audit_logs')->insert([
                'actor_user_id' => $actorId,
                'action' => "booking.{$to}",
                'entity_type' => 'booking',
                'entity_id' => (string) $bookingId,
                'details' => json_encode(['from' => $from, 'to' => $to, 'note' => $note], JSON_THROW_ON_ERROR),
                'created_at' => now('UTC'),
            ]);
        }
    }

    public function notify(int $userId, string $type, string $title, string $body, ?int $bookingId = null): void
    {
        DB::table('notifications')->insert([
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'related_booking_id' => $bookingId,
            'created_at' => now('UTC'),
        ]);
    }
}
