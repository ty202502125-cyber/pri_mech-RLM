<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BookingWorkflowService;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RepairController extends Controller
{
    public function mine(Request $request): JsonResponse
    {
        $repairs = DB::table('repair_records as r')->join('bookings as b', 'b.id', '=', 'r.booking_id')
            ->where('b.customer_id', $request->user()->id)->orderByDesc('r.updated_at')
            ->get(['r.id', 'r.booking_id', 'r.status', 'r.inspection_notes', 'r.estimate_amount', 'r.estimate_status', 'r.final_amount', 'r.completion_notes', 'r.warranty_until', 'r.updated_at', 'b.booking_ref', 'b.bicycle_type', 'b.bicycle_brand', 'b.bicycle_model']);

        return response()->json(['repairs' => $repairs]);
    }

    public function show(Request $request, int $bookingId): JsonResponse
    {
        $repair = DB::table('repair_records as r')->join('bookings as b', 'b.id', '=', 'r.booking_id')
            ->where('r.booking_id', $bookingId)->first(['r.*', 'b.customer_id', 'b.booking_ref']);
        if (! $repair || ($request->user()->role !== 'admin' && (int) $repair->customer_id !== (int) $request->user()->id)) {
            return response()->json(['error' => 'Repair record not found.'], 404);
        }

        return response()->json([
            'repair' => $repair,
            'parts' => DB::table('repair_parts')->where('repair_id', $repair->id)->orderBy('id')->get(['id', 'part_name', 'quantity', 'unit_cost', 'notes', 'created_at']),
            'history' => DB::table('repair_status_history')->where('repair_id', $repair->id)->orderBy('id')->get(['previous_status', 'new_status', 'note', 'created_at']),
        ]);
    }

    public function create(Request $request, int $bookingId): JsonResponse
    {
        $data = $request->validate(['inspectionNotes' => ['nullable', 'string', 'max:10000']]);
        try {
            $id = DB::transaction(function () use ($request, $bookingId, $data): int {
                $booking = DB::table('bookings')->where('id', $bookingId)->lockForUpdate()->first(['status']);
                if (! $booking) {
                    throw new DomainException('Booking not found.', 404);
                }
                if ($booking->status !== 'in_progress') {
                    throw new DomainException('Start the repair after the confirmed bicycle has been checked in.', 409);
                }
                $id = DB::table('repair_records')->insertGetId(['booking_id' => $bookingId, 'status' => 'bicycle_received', 'inspection_notes' => $data['inspectionNotes'] ?? null, 'updated_by' => $request->user()->id, 'created_at' => now('UTC'), 'updated_at' => now('UTC')]);
                DB::table('repair_status_history')->insert(['repair_id' => $id, 'previous_status' => null, 'new_status' => 'bicycle_received', 'note' => $data['inspectionNotes'] ?? null, 'changed_by' => $request->user()->id, 'created_at' => now('UTC')]);
                DB::table('audit_logs')->insert(['actor_user_id' => $request->user()->id, 'action' => 'repair.created', 'entity_type' => 'repair', 'entity_id' => (string) $id, 'created_at' => now('UTC')]);

                return $id;
            }, 3);
        } catch (DomainException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getCode());
        } catch (QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'A repair record already exists for this booking.'], 409);
            } throw $e;
        }

        return response()->json(['id' => $id, 'message' => 'Repair record created.'], 201);
    }

    public function update(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', 'in:bicycle_received,inspection,awaiting_customer_approval,in_progress,quality_check,ready_for_pickup,completed'],
            'inspectionNotes' => ['sometimes', 'nullable', 'string', 'max:10000'], 'completionNotes' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'estimateAmount' => ['sometimes', 'numeric', 'min:0', 'max:10000000'], 'finalAmount' => ['sometimes', 'numeric', 'min:0', 'max:10000000'],
            'warrantyUntil' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'note' => ['nullable', 'string', 'max:1000'],
            'parts' => ['sometimes', 'array', 'max:50'], 'parts.*.name' => ['required_with:parts', 'string', 'max:160'],
            'parts.*.quantity' => ['required_with:parts', 'numeric', 'gt:0'], 'parts.*.unitCost' => ['required_with:parts', 'numeric', 'min:0'], 'parts.*.notes' => ['nullable', 'string', 'max:500'],
        ]);
        try {
            DB::transaction(function () use ($request, $id, $data, $workflow): void {
                $repair = DB::table('repair_records as r')->join('bookings as b', 'b.id', '=', 'r.booking_id')->where('r.id', $id)->lockForUpdate()->first(['r.*', 'b.customer_id', 'b.status as booking_status']);
                if (! $repair) {
                    throw new DomainException('Repair record not found.', 404);
                }
                $transitions = ['bicycle_received' => ['inspection'], 'inspection' => ['awaiting_customer_approval', 'in_progress'], 'awaiting_customer_approval' => ['inspection', 'in_progress'], 'in_progress' => ['quality_check'], 'quality_check' => ['in_progress', 'ready_for_pickup'], 'ready_for_pickup' => ['completed'], 'completed' => []];
                $estimateChanged = array_key_exists('estimateAmount', $data);
                $next = $estimateChanged ? 'awaiting_customer_approval' : ($data['status'] ?? $repair->status);
                if ($next !== $repair->status && ! in_array($next, $transitions[$repair->status] ?? [], true)) {
                    throw new DomainException("Repair cannot move from {$repair->status} to {$next}.", 409);
                }
                if ($repair->estimate_status === 'pending' && $next !== 'awaiting_customer_approval') {
                    throw new DomainException('Wait for customer approval or decline before moving the repair forward.', 409);
                }
                if (isset($data['finalAmount']) && $repair->estimate_amount !== null && $data['finalAmount'] > (float) $repair->estimate_amount && ! $estimateChanged && $repair->estimate_status !== 'approved') {
                    throw new DomainException('Customer approval is required before increasing the approved estimate.', 409);
                }
                if ($next === 'completed' && (! array_key_exists('finalAmount', $data) && $repair->final_amount === null || empty($data['completionNotes']) && ! $repair->completion_notes)) {
                    throw new DomainException('Record the final cost and completion notes before completing the repair.', 400);
                }
                $updates = ['status' => $next, 'updated_by' => $request->user()->id, 'updated_at' => now('UTC')];
                foreach (['inspectionNotes' => 'inspection_notes', 'completionNotes' => 'completion_notes', 'estimateAmount' => 'estimate_amount', 'finalAmount' => 'final_amount', 'warrantyUntil' => 'warranty_until'] as $input => $column) {
                    if (array_key_exists($input, $data)) {
                        $updates[$column] = $data[$input];
                    }
                }
                if ($estimateChanged) {
                    $updates['estimate_status'] = 'pending';
                }
                DB::table('repair_records')->where('id', $id)->update($updates);
                if ($estimateChanged || array_key_exists('finalAmount', $data)) {
                    $payment = DB::table('payments')->where('booking_id', $repair->booking_id)->first(['id', 'estimated_amount', 'final_amount']);
                    $paymentValues = ['estimated_amount' => $data['estimateAmount'] ?? $repair->estimate_amount, 'final_amount' => $data['finalAmount'] ?? $repair->final_amount, 'updated_at' => now('UTC')];
                    if ($payment) {
                        DB::table('payments')->where('id', $payment->id)->update($paymentValues);
                        $this->recalculatePaymentSummary((int) $payment->id);
                    } else {
                        $paymentValues['booking_id'] = $repair->booking_id;
                        $paymentValues['created_at'] = now('UTC');
                        DB::table('payments')->insert($paymentValues);
                    }
                }
                if (isset($data['parts'])) {
                    foreach ($data['parts'] as $part) {
                        DB::table('repair_parts')->insert(['repair_id' => $id, 'part_name' => trim($part['name']), 'quantity' => $part['quantity'], 'unit_cost' => $part['unitCost'], 'notes' => $part['notes'] ?? null, 'created_at' => now('UTC')]);
                    }
                }
                if ($next !== $repair->status) {
                    DB::table('repair_status_history')->insert(['repair_id' => $id, 'previous_status' => $repair->status, 'new_status' => $next, 'note' => $data['note'] ?? null, 'changed_by' => $request->user()->id, 'created_at' => now('UTC')]);
                    $workflow->notify((int) $repair->customer_id, $estimateChanged ? 'estimate_approval' : 'repair_progress', $estimateChanged ? 'Repair estimate needs your approval' : 'Repair progress updated', $estimateChanged ? 'The mechanic proposed an estimate of PHP '.number_format((float) $data['estimateAmount'], 2).'.' : ($data['note'] ?? 'Repair status: '.str_replace('_', ' ', $next).'.'), (int) $repair->booking_id);
                }
                DB::table('audit_logs')->insert(['actor_user_id' => $request->user()->id, 'action' => 'repair.'.$next, 'entity_type' => 'repair', 'entity_id' => (string) $id, 'details' => json_encode(['note' => $data['note'] ?? null]), 'created_at' => now('UTC')]);
                if ($next === 'completed' && $repair->booking_status === 'in_progress') {
                    $workflow->recordTransition((int) $repair->booking_id, 'in_progress', 'completed', (int) $request->user()->id, 'admin', $data['completionNotes'] ?? $data['note'] ?? null);
                    DB::table('bookings')->where('id', $repair->booking_id)->update(['status' => 'completed', 'updated_at' => now('UTC')]);
                }
            }, 3);
        } catch (DomainException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getCode());
        }

        return response()->json(['message' => 'Repair record updated.']);
    }

    public function respondToEstimate(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', 'in:approved,declined']]);
        try {
            DB::transaction(function () use ($request, $id, $data, $workflow): void {
                $repair = DB::table('repair_records as r')->join('bookings as b', 'b.id', '=', 'r.booking_id')->where('r.id', $id)->where('b.customer_id', $request->user()->id)->lockForUpdate()->first(['r.*', 'b.id as booking_id']);
                if (! $repair) {
                    throw new DomainException('Estimate not found.', 404);
                }
                if ($repair->estimate_status !== 'pending' || $repair->status !== 'awaiting_customer_approval') {
                    throw new DomainException('There is no estimate awaiting your response.', 409);
                }
                $next = $data['decision'] === 'approved' ? 'in_progress' : 'inspection';
                DB::table('repair_records')->where('id', $id)->update(['estimate_status' => $data['decision'], 'status' => $next, 'updated_at' => now('UTC')]);
                DB::table('repair_status_history')->insert(['repair_id' => $id, 'previous_status' => $repair->status, 'new_status' => $next, 'note' => 'Customer '.$data['decision'].' the estimate.', 'changed_by' => $request->user()->id, 'created_at' => now('UTC')]);
                foreach (DB::table('users')->where('role', 'admin')->where('is_active', 1)->pluck('id') as $adminId) {
                    $workflow->notify((int) $adminId, 'estimate_response', 'Customer responded to estimate', 'The customer '.$data['decision'].' the repair estimate.', (int) $repair->booking_id);
                }
            }, 3);
        } catch (DomainException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getCode());
        }

        return response()->json(['message' => 'Estimate '.$data['decision'].'.']);
    }

    private function recalculatePaymentSummary(int $paymentId): void
    {
        $summary = DB::table('payments as p')->leftJoin('payment_transactions as pt', 'pt.payment_id', '=', 'p.id')
            ->where('p.id', $paymentId)->groupBy('p.id')
            ->selectRaw("p.final_amount, p.estimated_amount,
                COALESCE(SUM(CASE WHEN pt.status = 'verified' THEN pt.amount ELSE 0 END), 0) AS verified_total,
                COALESCE(SUM(pt.status = 'refunded'), 0) AS refund_count")
            ->first();
        $target = (float) ($summary->final_amount ?? $summary->estimated_amount ?? 0);
        $verified = (float) $summary->verified_total;
        $status = $verified > 0 ? ($target > 0 && $verified >= $target ? 'paid' : 'partially_paid') : ((int) $summary->refund_count > 0 ? 'refunded' : 'pending');
        DB::table('payments')->where('id', $paymentId)->update(['status' => $status, 'updated_at' => now('UTC')]);
    }
}
