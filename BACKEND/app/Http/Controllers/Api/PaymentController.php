<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BookingWorkflowService;
use App\Services\PrivateFileService;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PaymentController extends Controller
{
    public function customerPayments(Request $request): JsonResponse
    {
        $payments = DB::table('payments as p')->join('bookings as b', 'b.id', '=', 'p.booking_id')
            ->where('b.customer_id', $request->user()->id)->orderByDesc('p.updated_at')
            ->get(['p.id', 'p.booking_id', 'p.estimated_amount', 'p.final_amount', 'p.status', 'p.created_at', 'p.updated_at', 'b.booking_ref']);

        foreach ($payments as $payment) {
            $payment->transactions = DB::table('payment_transactions')->where('payment_id', $payment->id)
                ->whereNull('booking_group_payment_id')->orderByDesc('created_at')
                ->get(['id', 'method', 'amount', 'transaction_ref', 'status', 'admin_note', 'verified_at', 'created_at']);
        }

        return response()->json(['payments' => $payments]);
    }

    public function adminPayments(): JsonResponse
    {
        $payments = DB::table('payments as p')->join('bookings as b', 'b.id', '=', 'p.booking_id')
            ->join('users as u', 'u.id', '=', 'b.customer_id')->orderByDesc('p.updated_at')
            ->get(['p.id', 'p.booking_id', 'p.estimated_amount', 'p.final_amount', 'p.status', 'p.created_at', 'p.updated_at', 'b.booking_ref', 'u.full_name as customer_name', 'u.email as customer_email']);

        foreach ($payments as $payment) {
            $payment->transactions = DB::table('payment_transactions')->where('payment_id', $payment->id)
                ->whereNull('booking_group_payment_id')->orderByDesc('created_at')
                ->selectRaw('id, method, amount, transaction_ref, status, proof_path IS NOT NULL AS has_proof, admin_note, verified_at, created_at')->get();
        }

        return response()->json(['payments' => $payments]);
    }

    public function submit(Request $request, PrivateFileService $files, BookingWorkflowService $workflow): JsonResponse
    {
        if ($request->user()->role !== 'customer') {
            return response()->json(['error' => 'Customer account required.'], 403);
        }

        $bookingId = filter_var($request->input('bookingId'), FILTER_VALIDATE_INT);
        $amount = filter_var($request->input('amount'), FILTER_VALIDATE_FLOAT);
        $method = (string) $request->input('method', '');
        $transactionRef = trim((string) $request->input('transactionRef', ''));
        $proof = $files->parseProof($request->input('proofData'));

        if (! $bookingId || $bookingId < 1 || $amount === false || $amount <= 0 || $amount > 10000000
            || ! in_array($method, ['gcash', 'bank_transfer'], true) || mb_strlen($transactionRef) < 3 || mb_strlen($transactionRef) > 160 || ! $proof) {
            return response()->json(['error' => 'Enter a valid amount, transfer method, transaction reference, and JPEG/PNG/PDF proof up to 5 MB.'], 400);
        }

        $filename = null;
        try {
            $filename = $files->save($proof, 'payment-proofs');
            $result = DB::transaction(function () use ($request, $bookingId, $amount, $method, $transactionRef, $filename, $workflow): array {
                $booking = DB::table('bookings')->where('id', $bookingId)->where('customer_id', $request->user()->id)
                    ->lockForUpdate()->first(['id', 'status', 'reservation_expires_at']);
                if (! $booking) {
                    throw new DomainException('Booking not found.', 404);
                }

                if (! in_array($booking->status, ['awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'in_progress', 'completed'], true)) {
                    throw new DomainException('Payment can only be submitted for an approved booking or an outstanding repair balance.', 409);
                }
                if ($booking->status === 'awaiting_payment' && (! $booking->reservation_expires_at || strtotime($booking->reservation_expires_at.' UTC') <= time())) {
                    throw new DomainException('The two-hour payment reservation expired. Contact the mechanic to request a new time.', 409);
                }

                $payment = DB::table('payments')->where('booking_id', $bookingId)->lockForUpdate()->first(['id', 'final_amount', 'estimated_amount']);
                if (! $payment) {
                    throw new DomainException('The approved booking has no payment record. Contact the mechanic.', 409);
                }

                $totals = DB::table('payment_transactions')->where('payment_id', $payment->id)
                    ->selectRaw("COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS verified,
                        COALESCE(SUM(CASE WHEN status IN ('pending', 'submitted') THEN amount ELSE 0 END), 0) AS outstanding")
                    ->first();
                $target = (float) ($payment->final_amount ?? $payment->estimated_amount ?? 0);
                if ($amount + (float) $totals->verified + (float) $totals->outstanding > $target) {
                    throw new DomainException('This payment exceeds the remaining repair balance.', 409);
                }
                if ((float) $totals->outstanding > 0) {
                    throw new DomainException('A payment submission is already awaiting mechanic verification.', 409);
                }

                $transactionId = DB::table('payment_transactions')->insertGetId([
                    'payment_id' => $payment->id,
                    'method' => $method,
                    'amount' => $amount,
                    'transaction_ref' => $transactionRef,
                    'proof_path' => $filename,
                    'status' => 'submitted',
                    'created_at' => now('UTC'),
                    'updated_at' => now('UTC'),
                ]);

                if (in_array($booking->status, ['awaiting_payment', 'payment_rejected'], true)) {
                    $workflow->recordTransition($bookingId, $booking->status, 'payment_submitted', (int) $request->user()->id, 'customer', 'Customer submitted payment proof for verification.');
                    DB::table('bookings')->where('id', $bookingId)->update(['status' => 'payment_submitted', 'updated_at' => now('UTC')]);
                }

                foreach (DB::table('users')->where('role', 'admin')->where('is_active', 1)->pluck('id') as $adminId) {
                    $workflow->notify((int) $adminId, 'payment_submitted', 'Payment proof submitted', "A customer submitted payment proof for booking {$bookingId}.", $bookingId);
                }
                $this->audit((int) $request->user()->id, 'payment.submitted', 'payment_transaction', (string) $transactionId);

                return ['id' => $transactionId, 'status' => 'submitted', 'message' => 'Payment submitted for mechanic verification.'];
            }, 3);
        } catch (DomainException $exception) {
            if ($filename) {
                $files->delete('payment-proofs', $filename);
            }

            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        } catch (QueryException $exception) {
            if ($filename) {
                $files->delete('payment-proofs', $filename);
            }
            if (($exception->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'That transaction reference has already been submitted.'], 409);
            }
            throw $exception;
        } catch (\Throwable $exception) {
            if ($filename) {
                $files->delete('payment-proofs', $filename);
            }
            throw $exception;
        }

        return response()->json($result, 201);
    }

    public function submitGroup(Request $request, int $id, PrivateFileService $files, BookingWorkflowService $workflow): JsonResponse
    {
        if ($request->user()->role !== 'customer') {
            return response()->json(['error' => 'Customer account required.'], 403);
        }
        $amount = filter_var($request->input('amount'), FILTER_VALIDATE_FLOAT);
        $method = (string) $request->input('method', '');
        $transactionRef = trim((string) $request->input('transactionRef', ''));
        $proof = $files->parseProof($request->input('proofData'));
        if ($id < 1 || $amount === false || $amount <= 0 || $amount > 10000000
            || ! in_array($method, ['gcash', 'bank_transfer'], true) || mb_strlen($transactionRef) < 3 || mb_strlen($transactionRef) > 160 || ! $proof) {
            return response()->json(['error' => 'Enter a valid total, transfer method, transaction reference, and JPEG/PNG/PDF proof up to 5 MB.'], 400);
        }

        $filename = null;
        try {
            $filename = $files->save($proof, 'payment-proofs');
            $result = DB::transaction(function () use ($request, $id, $amount, $method, $transactionRef, $filename, $workflow): array {
                $group = DB::table('booking_groups')->where('id', $id)->where('customer_id', $request->user()->id)->lockForUpdate()->first(['id', 'group_ref', 'payment_choice']);
                if (! $group) {
                    throw new DomainException('Booking group not found.', 404);
                }
                if ($group->payment_choice !== 'together') {
                    throw new DomainException('This request is set up for separate bicycle payments.', 409);
                }

                $bookings = DB::table('bookings as b')->leftJoin('payments as p', 'p.booking_id', '=', 'b.id')
                    ->where('b.booking_group_id', $id)->where('b.customer_id', $request->user()->id)->orderBy('b.id')->lockForUpdate()
                    ->selectRaw("b.id, b.status, b.reservation_expires_at, p.id AS payment_id, p.final_amount, p.estimated_amount,
                        COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.payment_id = p.id AND pt.status = 'verified'), 0) AS verified_amount,
                        COALESCE((SELECT COUNT(*) FROM payment_transactions pt WHERE pt.payment_id = p.id AND pt.status IN ('pending', 'submitted')), 0) AS pending_count")
                    ->get();
                $alreadySubmitted = DB::table('booking_group_payments')->where('group_id', $id)->where('status', 'submitted')->lockForUpdate()->exists();

                if ($bookings->isEmpty() || $bookings->contains(fn ($b) => ! $b->payment_id
                    || ! in_array($b->status, ['awaiting_payment', 'payment_rejected'], true)
                    || ! $b->reservation_expires_at || strtotime($b->reservation_expires_at.' UTC') <= time()
                    || (int) $b->pending_count > 0) || $alreadySubmitted) {
                    throw new DomainException('Combined payment is available after every bicycle has an active, approved reservation and no payment is awaiting review.', 409);
                }

                $balances = $bookings->map(function ($booking): array {
                    $target = (float) ($booking->final_amount ?? $booking->estimated_amount ?? 0);
                    $balance = max(0, round($target - (float) $booking->verified_amount, 2));

                    return ['booking' => $booking, 'balance' => $balance];
                })->filter(fn ($entry) => $entry['balance'] > 0)->values();
                $totalCents = (int) $balances->sum(fn ($entry) => (int) round($entry['balance'] * 100));
                if ($balances->isEmpty() || (int) round($amount * 100) !== $totalCents) {
                    throw new DomainException('Enter the exact combined outstanding balance of PHP '.number_format($totalCents / 100, 2).'.', 409);
                }

                $submissionId = DB::table('booking_group_payments')->insertGetId([
                    'group_id' => $id,
                    'method' => $method,
                    'amount' => $amount,
                    'transaction_ref' => $transactionRef,
                    'proof_path' => $filename,
                    'status' => 'submitted',
                    'created_at' => now('UTC'),
                    'updated_at' => now('UTC'),
                ]);

                foreach ($balances as $entry) {
                    $booking = $entry['booking'];
                    $paymentId = (int) $booking->payment_id;
                    DB::table('payment_transactions')->insert([
                        'payment_id' => $paymentId,
                        'booking_group_payment_id' => $submissionId,
                        'method' => $method,
                        'amount' => $entry['balance'],
                        'transaction_ref' => null,
                        'proof_path' => $filename,
                        'status' => 'submitted',
                        'created_at' => now('UTC'),
                        'updated_at' => now('UTC'),
                    ]);
                    $this->updatePaymentSummary($paymentId);
                    $workflow->recordTransition((int) $booking->id, $booking->status, 'payment_submitted', (int) $request->user()->id,
                        'customer', 'Customer submitted combined payment proof for the booking group.');
                    DB::table('bookings')->where('id', $booking->id)->update(['status' => 'payment_submitted', 'updated_at' => now('UTC')]);
                }

                foreach (DB::table('users')->where('role', 'admin')->where('is_active', 1)->pluck('id') as $adminId) {
                    $workflow->notify((int) $adminId, 'payment_submitted', 'Combined payment proof submitted', "A customer submitted payment for group {$group->group_ref}.", (int) $balances[0]['booking']->id);
                }
                $this->audit((int) $request->user()->id, 'payment.group_submitted', 'booking_group_payment', (string) $submissionId);

                return ['id' => $submissionId, 'status' => 'submitted', 'message' => 'Combined payment submitted for mechanic verification.'];
            }, 3);
        } catch (DomainException $exception) {
            if ($filename) {
                $files->delete('payment-proofs', $filename);
            }

            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        } catch (QueryException $exception) {
            if ($filename) {
                $files->delete('payment-proofs', $filename);
            }
            if (($exception->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'That transaction reference has already been submitted.'], 409);
            }
            throw $exception;
        } catch (\Throwable $exception) {
            if ($filename) {
                $files->delete('payment-proofs', $filename);
            }
            throw $exception;
        }

        return response()->json($result, 201);
    }

    public function groupPayments(): JsonResponse
    {
        $submissions = DB::table('booking_group_payments as bgp')
            ->join('booking_groups as bg', 'bg.id', '=', 'bgp.group_id')
            ->join('users as u', 'u.id', '=', 'bg.customer_id')
            ->orderByDesc('bgp.created_at')
            ->get(['bgp.id', 'bgp.group_id', 'bgp.method', 'bgp.amount', 'bgp.transaction_ref', 'bgp.status', 'bgp.admin_note', 'bgp.verified_at', 'bgp.created_at', 'bg.group_ref', 'u.full_name as customer_name']);

        foreach ($submissions as $submission) {
            $submission->booking_refs = DB::table('bookings')->where('booking_group_id', $submission->group_id)->orderBy('id')->pluck('booking_ref');
            $submission->has_proof = true;
        }

        return response()->json(['submissions' => $submissions]);
    }

    public function proof(Request $request, int $id, PrivateFileService $files, bool $group = false)
    {
        if ($group) {
            $row = DB::table('booking_group_payments as bgp')->join('booking_groups as bg', 'bg.id', '=', 'bgp.group_id')
                ->where('bgp.id', $id)->first(['bgp.proof_path', 'bg.customer_id']);
            $ownerId = $row?->customer_id;
            $path = $row?->proof_path;
        } else {
            $row = DB::table('payment_transactions as pt')->join('payments as p', 'p.id', '=', 'pt.payment_id')
                ->join('bookings as b', 'b.id', '=', 'p.booking_id')->where('pt.id', $id)
                ->first(['pt.proof_path', 'b.customer_id']);
            $ownerId = $row?->customer_id;
            $path = $row?->proof_path;
        }

        if (! $row || ($request->user()->role !== 'admin' && (int) $ownerId !== (int) $request->user()->id)) {
            return response()->json(['error' => 'Payment proof not found.'], 404);
        }
        if (! $path) {
            return response()->json(['error' => 'This payment has no uploaded proof.'], 404);
        }

        $filename = basename($path);
        $fullPath = $files->path('payment-proofs', $filename);
        if (! is_file($fullPath)) {
            return response()->json(['error' => 'Payment proof file is unavailable.'], 404);
        }

        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $contentType = match ($extension) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            default => 'application/pdf',
        };

        return response()->file($fullPath, [
            'Content-Type' => $contentType,
            'Content-Disposition' => 'inline; filename="'.$filename.'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function proofGroup(Request $request, int $id, PrivateFileService $files)
    {
        return $this->proof($request, $id, $files, true);
    }

    public function verify(int $id, BookingWorkflowService $workflow): JsonResponse
    {
        return $this->reviewTransaction($id, true, null, $workflow);
    }

    public function reject(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        $note = trim((string) $request->input('note', ''));
        if (mb_strlen($note) < 3 || mb_strlen($note) > 1000) {
            return response()->json(['error' => 'Provide a short reason for rejecting this payment.'], 400);
        }

        return $this->reviewTransaction($id, false, $note, $workflow);
    }

    public function verifyGroup(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        try {
            DB::transaction(function () use ($request, $id, $workflow): void {
                $submission = DB::table('booking_group_payments')->where('id', $id)->lockForUpdate()->first(['id', 'group_id', 'status']);
                if (! $submission) {
                    throw new DomainException('Group payment not found.', 404);
                }
                if ($submission->status !== 'submitted') {
                    throw new DomainException('This group payment is no longer awaiting verification.', 409);
                }

                $transactions = $this->groupTransactions($id);
                if ($transactions->isEmpty() || $transactions->contains(fn ($row) => $row->booking_status !== 'payment_submitted')) {
                    throw new DomainException('The group payment does not have a complete set of pending bicycle payments.', 409);
                }

                DB::table('booking_group_payments')->where('id', $id)->update(['status' => 'verified', 'verified_by' => $request->user()->id, 'verified_at' => now('UTC'), 'updated_at' => now('UTC')]);
                DB::table('payment_transactions')->where('booking_group_payment_id', $id)->where('status', 'submitted')
                    ->update(['status' => 'verified', 'verified_by' => $request->user()->id, 'verified_at' => now('UTC'), 'updated_at' => now('UTC')]);

                foreach ($transactions as $transaction) {
                    $summary = $this->updatePaymentSummary((int) $transaction->payment_id);
                    if ($summary['status'] !== 'paid') {
                        throw new DomainException('The combined amount does not cover every bicycle’s full payment.', 409);
                    }
                    $workflow->recordTransition((int) $transaction->booking_id, 'payment_submitted', 'confirmed', (int) $request->user()->id, 'admin', 'Combined payment verified; appointment confirmed.');
                    DB::table('bookings')->where('id', $transaction->booking_id)->update(['status' => 'confirmed', 'reservation_expires_at' => null, 'updated_at' => now('UTC')]);
                    $workflow->notify((int) $transaction->customer_id, 'payment_verified', 'Combined payment verified', 'The mechanic verified the combined payment for your booking group.', (int) $transaction->booking_id);
                }

                $this->audit((int) $request->user()->id, 'payment.group_verified', 'booking_group_payment', (string) $id);
            }, 3);
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        }

        return response()->json(['message' => 'Combined payment verified; all bicycle appointments are confirmed.']);
    }

    public function rejectGroup(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        $note = trim((string) $request->input('note', ''));
        if (mb_strlen($note) < 3 || mb_strlen($note) > 1000) {
            return response()->json(['error' => 'Provide a short reason for rejecting this combined payment.'], 400);
        }

        try {
            DB::transaction(function () use ($request, $id, $note, $workflow): void {
                $submission = DB::table('booking_group_payments')->where('id', $id)->lockForUpdate()->first(['id', 'status']);
                if (! $submission) {
                    throw new DomainException('Group payment not found.', 404);
                }
                if ($submission->status !== 'submitted') {
                    throw new DomainException('This group payment is no longer awaiting review.', 409);
                }
                $transactions = $this->groupTransactions($id);
                DB::table('booking_group_payments')->where('id', $id)->update(['status' => 'rejected', 'admin_note' => $note, 'verified_by' => $request->user()->id, 'verified_at' => now('UTC'), 'updated_at' => now('UTC')]);
                DB::table('payment_transactions')->where('booking_group_payment_id', $id)->where('status', 'submitted')
                    ->update(['status' => 'rejected', 'admin_note' => $note, 'verified_by' => $request->user()->id, 'verified_at' => now('UTC'), 'updated_at' => now('UTC')]);

                foreach ($transactions as $transaction) {
                    $this->updatePaymentSummary((int) $transaction->payment_id);
                    if ($transaction->booking_status === 'payment_submitted') {
                        $workflow->recordTransition((int) $transaction->booking_id, 'payment_submitted', 'payment_rejected', (int) $request->user()->id, 'admin', $note);
                        DB::table('bookings')->where('id', $transaction->booking_id)->update(['status' => 'payment_rejected', 'updated_at' => now('UTC')]);
                    }
                }
            }, 3);
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        }

        return response()->json(['message' => 'Combined payment rejected.']);
    }

    public function cash(Request $request, BookingWorkflowService $workflow): JsonResponse
    {
        $bookingId = filter_var($request->input('bookingId'), FILTER_VALIDATE_INT);
        $amount = filter_var($request->input('amount'), FILTER_VALIDATE_FLOAT);
        if (! $bookingId || $bookingId < 1 || $amount === false || $amount <= 0 || $amount > 10000000) {
            return response()->json(['error' => 'Enter a valid booking and cash amount.'], 400);
        }

        try {
            $result = DB::transaction(function () use ($request, $bookingId, $amount, $workflow): array {
                $payment = DB::table('bookings as b')->join('payments as p', 'p.booking_id', '=', 'b.id')
                    ->where('b.id', $bookingId)->lockForUpdate()
                    ->first(['b.customer_id', 'b.status as booking_status', 'b.reservation_expires_at', 'p.id as payment_id', 'p.final_amount', 'p.estimated_amount']);
                if (! $payment) {
                    throw new DomainException('Payment record not found for this booking.', 404);
                }
                if ($payment->booking_status === 'awaiting_payment' && (! $payment->reservation_expires_at || strtotime($payment->reservation_expires_at.' UTC') <= time())) {
                    throw new DomainException('The two-hour payment reservation expired. Reapprove the booking before recording payment.', 409);
                }
                $verified = (float) DB::table('payment_transactions')->where('payment_id', $payment->payment_id)->where('status', 'verified')->sum('amount');
                $target = (float) ($payment->final_amount ?? $payment->estimated_amount ?? 0);
                if ($target <= 0 || $verified + $amount > $target) {
                    throw new DomainException('Cash amount exceeds the remaining repair balance.', 409);
                }

                $transactionId = DB::table('payment_transactions')->insertGetId([
                    'payment_id' => $payment->payment_id,
                    'method' => 'cash',
                    'amount' => $amount,
                    'transaction_ref' => 'CASH-'.strtoupper(bin2hex(random_bytes(16))),
                    'status' => 'verified',
                    'verified_by' => $request->user()->id,
                    'verified_at' => now('UTC'),
                    'admin_note' => 'Cash received by mechanic',
                    'created_at' => now('UTC'),
                    'updated_at' => now('UTC'),
                ]);
                $summary = $this->updatePaymentSummary((int) $payment->payment_id);
                if ($summary['status'] === 'paid' && $payment->booking_status === 'awaiting_payment') {
                    $workflow->recordTransition($bookingId, 'awaiting_payment', 'confirmed', (int) $request->user()->id, 'admin', 'Full cash payment received; appointment confirmed.');
                    DB::table('bookings')->where('id', $bookingId)->update(['status' => 'confirmed', 'reservation_expires_at' => null, 'updated_at' => now('UTC')]);
                }
                $workflow->notify((int) $payment->customer_id, 'payment_verified', 'Cash payment recorded', 'The mechanic recorded PHP '.number_format($amount, 2).' in cash.', $bookingId);
                $this->audit((int) $request->user()->id, 'payment.cash_recorded', 'payment_transaction', (string) $transactionId);

                return ['id' => $transactionId, 'paymentStatus' => $summary['status']];
            }, 3);
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        }

        return response()->json($result + ['message' => 'Cash payment recorded.'], 201);
    }

    public function refund(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        $note = mb_substr(trim((string) $request->input('note', '')), 0, 1000) ?: 'Refund issued by mechanic';
        try {
            $summary = DB::transaction(function () use ($request, $id, $note, $workflow): array {
                $transaction = DB::table('payment_transactions as pt')->join('payments as p', 'p.id', '=', 'pt.payment_id')
                    ->join('bookings as b', 'b.id', '=', 'p.booking_id')->where('pt.id', $id)->lockForUpdate()
                    ->first(['pt.*', 'p.booking_id', 'b.customer_id']);
                if (! $transaction) {
                    throw new DomainException('Payment transaction not found.', 404);
                }
                if ($transaction->status !== 'verified') {
                    throw new DomainException('Only verified payments can be refunded.', 409);
                }

                DB::table('payment_transactions')->where('id', $id)->update(['status' => 'refunded', 'admin_note' => $note, 'updated_at' => now('UTC')]);
                DB::table('payment_transactions')->insert([
                    'payment_id' => $transaction->payment_id,
                    'method' => $transaction->method,
                    'amount' => $transaction->amount,
                    'transaction_ref' => 'REFUND-'.$id.'-'.strtoupper(bin2hex(random_bytes(4))),
                    'status' => 'refunded',
                    'admin_note' => $note,
                    'verified_by' => $request->user()->id,
                    'verified_at' => now('UTC'),
                    'created_at' => now('UTC'),
                    'updated_at' => now('UTC'),
                ]);
                $summary = $this->updatePaymentSummary((int) $transaction->payment_id);
                $workflow->notify((int) $transaction->customer_id, 'payment_refunded', 'Payment refunded', $note, (int) $transaction->booking_id);
                $this->audit((int) $request->user()->id, 'payment.refunded', 'payment_transaction', (string) $id, ['amount' => $transaction->amount, 'note' => $note]);

                return $summary;
            }, 3);
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        }

        return response()->json(['message' => 'Full payment refund recorded.', 'paymentStatus' => $summary['status']]);
    }

    private function reviewTransaction(int $id, bool $verify, ?string $note, BookingWorkflowService $workflow): JsonResponse
    {
        try {
            $result = DB::transaction(function () use ($id, $verify, $note, $workflow): array {
                $transaction = DB::table('payment_transactions as pt')->join('payments as p', 'p.id', '=', 'pt.payment_id')
                    ->join('bookings as b', 'b.id', '=', 'p.booking_id')->where('pt.id', $id)->lockForUpdate()
                    ->first(['pt.id', 'pt.payment_id', 'pt.status', 'p.booking_id', 'b.customer_id', 'b.status as booking_status', 'b.reservation_expires_at']);
                if (! $transaction) {
                    throw new DomainException('Payment transaction not found.', 404);
                }
                if (! in_array($transaction->status, ['pending', 'submitted'], true)) {
                    throw new DomainException('This payment is no longer awaiting verification.', 409);
                }

                DB::table('payment_transactions')->where('id', $id)->update([
                    'status' => $verify ? 'verified' : 'rejected',
                    'admin_note' => $verify ? DB::raw('admin_note') : $note,
                    'verified_by' => auth()->id(),
                    'verified_at' => now('UTC'),
                    'updated_at' => now('UTC'),
                ]);
                $summary = $this->updatePaymentSummary((int) $transaction->payment_id);

                if ($verify && $summary['status'] === 'paid' && $transaction->booking_status === 'payment_submitted') {
                    $workflow->recordTransition((int) $transaction->booking_id, 'payment_submitted', 'confirmed', (int) auth()->id(), 'admin', 'Payment verified; appointment confirmed.');
                    DB::table('bookings')->where('id', $transaction->booking_id)->update(['status' => 'confirmed', 'reservation_expires_at' => null, 'updated_at' => now('UTC')]);
                }

                if (! $verify && $transaction->booking_status === 'payment_submitted' && $summary['pendingCount'] === 0) {
                    $expired = ! $transaction->reservation_expires_at || strtotime($transaction->reservation_expires_at.' UTC') <= time();
                    $nextStatus = $expired ? 'payment_rejected' : 'awaiting_payment';
                    $workflow->recordTransition((int) $transaction->booking_id, 'payment_submitted', $nextStatus, (int) auth()->id(), 'admin', $note);
                    DB::table('bookings')->where('id', $transaction->booking_id)->update([
                        'status' => $nextStatus,
                        'reservation_expires_at' => $expired ? null : $transaction->reservation_expires_at,
                        'updated_at' => now('UTC'),
                    ]);
                }

                $workflow->notify((int) $transaction->customer_id,
                    $verify ? 'payment_verified' : 'payment_rejected',
                    $verify ? 'Payment verified' : 'Payment needs attention',
                    $verify ? 'The mechanic verified your payment.' : $note,
                    (int) $transaction->booking_id);
                $this->audit((int) auth()->id(), $verify ? 'payment.verified' : 'payment.rejected', 'payment_transaction', (string) $id, $verify ? null : ['note' => $note]);

                return $summary;
            }, 3);
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        }

        return response()->json(['message' => $verify ? 'Payment verified.' : 'Payment rejected.', 'paymentStatus' => $result['status']]);
    }

    private function groupTransactions(int $groupPaymentId)
    {
        return DB::table('payment_transactions as pt')->join('payments as p', 'p.id', '=', 'pt.payment_id')
            ->join('bookings as b', 'b.id', '=', 'p.booking_id')->where('pt.booking_group_payment_id', $groupPaymentId)
            ->where('pt.status', 'submitted')->orderBy('b.id')->lockForUpdate()
            ->get(['pt.id as transaction_id', 'pt.payment_id', 'p.booking_id', 'b.customer_id', 'b.status as booking_status']);
    }

    private function updatePaymentSummary(int $paymentId): array
    {
        $payment = DB::table('payments as p')->leftJoin('payment_transactions as pt', 'pt.payment_id', '=', 'p.id')
            ->where('p.id', $paymentId)->groupBy('p.id')
            ->selectRaw("p.final_amount, p.estimated_amount,
                COALESCE(SUM(CASE WHEN pt.status = 'verified' THEN pt.amount ELSE 0 END), 0) AS verified_total,
                COALESCE(SUM(pt.status IN ('pending', 'submitted')), 0) AS pending_count,
                COALESCE(SUM(pt.status = 'refunded'), 0) AS refund_count")
            ->first();
        $target = (float) ($payment->final_amount ?? $payment->estimated_amount ?? 0);
        $verified = (float) $payment->verified_total;
        $status = $verified > 0
            ? ($target > 0 && $verified >= $target ? 'paid' : 'partially_paid')
            : ((int) $payment->refund_count > 0 ? 'refunded' : 'pending');
        DB::table('payments')->where('id', $paymentId)->update(['status' => $status, 'updated_at' => now('UTC')]);

        return ['target' => $target, 'verified' => $verified, 'status' => $status, 'pendingCount' => (int) $payment->pending_count];
    }

    private function audit(int $actorId, string $action, string $entityType, string $entityId, ?array $details = null): void
    {
        DB::table('audit_logs')->insert([
            'actor_user_id' => $actorId,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'details' => $details ? json_encode($details, JSON_THROW_ON_ERROR) : null,
            'created_at' => now('UTC'),
        ]);
    }
}
