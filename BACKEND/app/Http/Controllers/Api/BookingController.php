<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AvailabilityService;
use App\Services\BookingWorkflowService;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BookingController extends Controller
{
    private const BIKE_TYPES = ['Road bike', 'Mountain bike', 'Gravel bike', 'City / commuter bike'];

    public function mine(Request $request): JsonResponse
    {
        $bookings = DB::table('bookings as b')
            ->join('services as s', 's.id', '=', 'b.service_id')
            ->leftJoin('booking_groups as bg', 'bg.id', '=', 'b.booking_group_id')
            ->leftJoin('payments as p', 'p.booking_id', '=', 'b.id')
            ->leftJoin('customer_reviews as r', 'r.booking_id', '=', 'b.id')
            ->where('b.customer_id', $request->user()->id)
            ->orderByDesc('b.created_at')
            ->selectRaw("b.id, b.booking_ref, b.bicycle_type, b.bicycle_brand, b.bicycle_model,
                b.problem_description, b.preferred_at, b.scheduled_at, b.status, b.admin_note,
                b.reservation_expires_at, b.created_at, p.status AS payment_status,
                p.estimated_amount, p.final_amount,
                COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.payment_id = p.id AND pt.status = 'verified'), 0) AS verified_amount,
                bg.id AS booking_group_id, bg.group_ref, bg.payment_choice,
                (SELECT COUNT(*) FROM booking_photos bp WHERE bp.booking_id = b.id) AS photo_count,
                (SELECT status FROM booking_group_payments bgp WHERE bgp.group_id = bg.id ORDER BY bgp.created_at DESC LIMIT 1) AS group_payment_status,
                (SELECT id FROM booking_group_payments bgp WHERE bgp.group_id = bg.id ORDER BY bgp.created_at DESC LIMIT 1) AS group_payment_id,
                (SELECT admin_note FROM booking_group_payments bgp WHERE bgp.group_id = bg.id ORDER BY bgp.created_at DESC LIMIT 1) AS group_payment_note,
                r.id AS review_id, r.rating AS review_rating, r.comment AS review_comment, r.is_anonymous AS review_is_anonymous,
                COALESCE((SELECT GROUP_CONCAT(ss.name ORDER BY ss.name SEPARATOR ', ') FROM booking_services bs
                    JOIN services ss ON ss.id = bs.service_id WHERE bs.booking_id = b.id), s.name) AS service_name");

        return response()->json(['bookings' => $bookings->get()]);
    }

    public function create(Request $request, AvailabilityService $availability, BookingWorkflowService $workflow): JsonResponse
    {
        if ($this->bookingsPaused()) {
            return response()->json(['error' => 'Online bookings are temporarily paused. Please check the latest workshop announcement.'], 503);
        }

        $serviceIds = $this->serviceIds($request->input('serviceIds', [$request->input('serviceId')]));

        if (! $serviceIds || count($serviceIds) > 10 || count($serviceIds) !== count(array_unique($serviceIds))
            || min($serviceIds) < 1) {
            return response()->json(['error' => 'Choose between one and ten different services.'], 400);
        }

        $bicycleId = $request->filled('bicycleId') ? filter_var($request->input('bicycleId'), FILTER_VALIDATE_INT) : null;
        if ($request->filled('bicycleId') && (! $bicycleId || $bicycleId < 1)) {
            return response()->json(['error' => 'Choose a valid registered bicycle.'], 400);
        }

        $bike = $this->prepareBike($request->all(), $bicycleId, $request->user()->id, $serviceIds, $availability);
        if (isset($bike['error'])) {
            return response()->json(['error' => $bike['error']], $bike['status'] ?? 400);
        }

        try {
            $created = DB::transaction(function () use ($bike, $availability, $workflow, $request): array {
                $slot = $availability->slotCheck($bike['preferredAt'], $bike['duration'], null, true);
                if (! $slot['available']) {
                    throw new DomainException($slot['reason'], 409);
                }

                $bookingRef = $this->reference('BM-', 5);
                $bookingId = DB::table('bookings')->insertGetId([
                    'booking_ref' => $bookingRef,
                    'customer_id' => $request->user()->id,
                    'bicycle_id' => $bike['bicycleId'],
                    'service_id' => $bike['serviceIds'][0],
                    'bicycle_type' => $bike['bicycleType'],
                    'bicycle_brand' => $bike['brand'],
                    'bicycle_model' => $bike['model'],
                    'problem_description' => $bike['problem'],
                    'preferred_at' => $availability->mysqlDateTime($bike['preferredAt']),
                    'status' => 'pending_review',
                    'created_at' => now('UTC'),
                    'updated_at' => now('UTC'),
                ]);

                $this->saveServiceSnapshots($bookingId, $bike['services']);
                DB::table('booking_status_history')->insert([
                    'booking_id' => $bookingId,
                    'previous_status' => null,
                    'new_status' => 'pending_review',
                    'note' => 'Customer submitted a booking request.',
                    'changed_by' => $request->user()->id,
                    'created_at' => now('UTC'),
                ]);

                foreach (DB::table('users')->where('role', 'admin')->where('is_active', 1)->pluck('id') as $adminId) {
                    $workflow->notify((int) $adminId, 'new_booking', 'New booking request', "A customer submitted request {$bookingRef}.", $bookingId);
                }

                return ['id' => $bookingId, 'bookingRef' => $bookingRef, 'status' => 'pending_review'];
            });
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode() === 409 ? 409 : 400);
        }

        return response()->json(['booking' => $created], 201);
    }

    public function createGroup(Request $request, AvailabilityService $availability, BookingWorkflowService $workflow): JsonResponse
    {
        $bikes = $request->input('bikes');
        $paymentChoice = (string) $request->input('paymentChoice', '');

        if (! is_array($bikes) || count($bikes) < 1 || count($bikes) > 10 || ! in_array($paymentChoice, ['together', 'separate'], true)) {
            return response()->json(['error' => 'Add one to ten bicycles and choose how you want to pay.'], 400);
        }

        if ($this->bookingsPaused()) {
            return response()->json(['error' => 'Online bookings are temporarily paused. Please check the latest workshop announcement.'], 503);
        }

        $registeredIds = array_filter(array_map(fn ($bike) => isset($bike['bicycleId']) && $bike['bicycleId'] !== '' ? (int) $bike['bicycleId'] : null, $bikes));
        if (count($registeredIds) !== count(array_unique($registeredIds))) {
            return response()->json(['error' => 'A registered bicycle can only be included once in a booking group.'], 400);
        }

        $prepared = [];
        foreach ($bikes as $bike) {
            $ids = $this->serviceIds($bike['serviceIds'] ?? []);
            if (! $ids || count($ids) > 10 || count($ids) !== count(array_unique($ids)) || min($ids) < 1) {
                return response()->json(['error' => 'Choose between one and ten different services for every bicycle.'], 400);
            }

            $bicycleId = isset($bike['bicycleId']) && $bike['bicycleId'] !== '' ? filter_var($bike['bicycleId'], FILTER_VALIDATE_INT) : null;
            if (isset($bike['bicycleId']) && $bike['bicycleId'] !== '' && (! $bicycleId || $bicycleId < 1)) {
                return response()->json(['error' => 'Choose a valid registered bicycle.'], 400);
            }

            $bikeData = $this->prepareBike($bike, $bicycleId, $request->user()->id, $ids, $availability, true);
            if (isset($bikeData['error'])) {
                return response()->json(['error' => $bikeData['error']], $bikeData['status'] ?? 400);
            }

            $prepared[] = $bikeData;
        }

        try {
            $result = DB::transaction(function () use ($prepared, $paymentChoice, $availability, $workflow, $request): array {
                foreach ($prepared as $bike) {
                    $slot = $availability->slotCheck($bike['preferredAt'], $bike['duration'], null, true);
                    if (! $slot['available']) {
                        throw new DomainException($slot['reason'], 409);
                    }
                }

                $groupRef = $this->reference('BG-', 5);
                $groupId = DB::table('booking_groups')->insertGetId([
                    'group_ref' => $groupRef,
                    'customer_id' => $request->user()->id,
                    'payment_choice' => $paymentChoice,
                    'created_at' => now('UTC'),
                ]);
                $createdBookings = [];

                foreach ($prepared as $bike) {
                    $bookingRef = $this->reference('BM-', 5);
                    $bookingId = DB::table('bookings')->insertGetId([
                        'booking_ref' => $bookingRef,
                        'customer_id' => $request->user()->id,
                        'booking_group_id' => $groupId,
                        'bicycle_id' => $bike['bicycleId'],
                        'service_id' => $bike['serviceIds'][0],
                        'bicycle_type' => $bike['bicycleType'],
                        'bicycle_brand' => $bike['brand'],
                        'bicycle_model' => $bike['model'],
                        'problem_description' => $bike['problem'],
                        'preferred_at' => $availability->mysqlDateTime($bike['preferredAt']),
                        'status' => 'pending_review',
                        'created_at' => now('UTC'),
                        'updated_at' => now('UTC'),
                    ]);

                    $this->saveServiceSnapshots($bookingId, $bike['services']);
                    DB::table('booking_status_history')->insert([
                        'booking_id' => $bookingId,
                        'previous_status' => null,
                        'new_status' => 'pending_review',
                        'note' => 'Customer submitted a grouped booking request.',
                        'changed_by' => $request->user()->id,
                        'created_at' => now('UTC'),
                    ]);
                    $createdBookings[] = ['id' => $bookingId, 'bookingRef' => $bookingRef, 'status' => 'pending_review'];
                }

                foreach (DB::table('users')->where('role', 'admin')->where('is_active', 1)->pluck('id') as $adminId) {
                    $workflow->notify((int) $adminId, 'new_booking', 'New multi-bicycle booking request',
                        "A customer submitted request {$groupRef} for ".count($createdBookings).' bicycles.', $createdBookings[0]['id']);
                }

                return ['group' => ['id' => $groupId, 'groupRef' => $groupRef, 'paymentChoice' => $paymentChoice], 'bookings' => $createdBookings];
            });
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode() === 409 ? 409 : 400);
        }

        return response()->json($result, 201);
    }

    public function cancel(Request $request, int $id, BookingWorkflowService $workflow): JsonResponse
    {
        try {
            DB::transaction(function () use ($request, $id, $workflow): void {
                $booking = DB::table('bookings')->where('id', $id)->where('customer_id', $request->user()->id)->lockForUpdate()->first(['status']);
                if (! $booking) {
                    throw new DomainException('Booking not found.', 404);
                }

                $workflow->recordTransition($id, $booking->status, 'cancelled', (int) $request->user()->id, 'customer');
                DB::table('bookings')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now('UTC')]);
            });
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode() === 404 ? 404 : 409);
        }

        return response()->json(['message' => 'Booking cancelled.']);
    }

    private function prepareBike(array $input, ?int $bicycleId, int $customerId, array $serviceIds, AvailabilityService $availability, bool $group = false): array
    {
        $type = trim((string) ($input['bicycleType'] ?? ''));
        $brand = mb_substr(trim((string) ($input['brand'] ?? '')), 0, 100) ?: null;
        $model = mb_substr(trim((string) ($input['model'] ?? '')), 0, 100) ?: null;
        $problem = trim((string) ($input['problem'] ?? ''));
        $dateValue = (string) ($input['preferredAt'] ?? '');

        if ($bicycleId !== null) {
            $bicycle = DB::table('bicycles')->where('id', $bicycleId)->where('customer_id', $customerId)->where('is_active', 1)->first(['brand', 'model', 'category']);
            if (! $bicycle) {
                return ['error' => $group ? 'One selected bicycle was not found in your account.' : 'The selected bicycle was not found in your account.', 'status' => 404];
            }
            $type = $bicycle->category;
            $brand = $bicycle->brand;
            $model = $bicycle->model;
        }

        if (! in_array($type, self::BIKE_TYPES, true)) {
            return ['error' => 'Choose a supported bicycle category for every bicycle.'];
        }
        if (mb_strlen($problem) < 8 || mb_strlen($problem) > 2000) {
            return ['error' => $group ? 'Describe each bicycle issue in 8 to 2,000 characters.' : 'Describe the issue (8 to 2,000 characters).'];
        }

        try {
            $preferredAt = CarbonImmutable::parse($dateValue)->utc();
        } catch (\Throwable) {
            return ['error' => $group ? 'Choose a future drop-off time for every bicycle.' : 'Choose a future preferred appointment time.'];
        }

        if ($preferredAt->lessThanOrEqualTo(CarbonImmutable::now('UTC'))) {
            return ['error' => $group ? 'Choose a future drop-off time for every bicycle.' : 'Choose a future preferred appointment time.'];
        }

        $services = DB::table('services')->whereIn('id', $serviceIds)->where('is_active', 1)
            ->get(['id', 'name', 'starting_price', 'estimated_minutes'])->keyBy('id');
        if ($services->count() !== count($serviceIds)) {
            return ['error' => 'One or more selected services are not currently available.'];
        }

        $duration = (int) $services->sum(fn ($service) => (int) $service->estimated_minutes);
        if ($duration > 1440) {
            return ['error' => $group ? 'The combined service duration is too long for one bicycle.' : 'The combined service duration is too long for one booking.'];
        }

        $slot = $availability->slotCheck($preferredAt, $duration);
        if (! $slot['available']) {
            return ['error' => $slot['reason'], 'status' => 409];
        }

        return compact('bicycleId', 'type', 'brand', 'model', 'problem', 'preferredAt', 'serviceIds', 'services', 'duration')
            + ['bicycleType' => $type];
    }

    private function saveServiceSnapshots(int $bookingId, $services): void
    {
        foreach ($services as $service) {
            DB::table('booking_services')->insert([
                'booking_id' => $bookingId,
                'service_id' => $service->id,
                'service_name_snapshot' => $service->name,
                'unit_price_snapshot' => $service->starting_price,
                'duration_snapshot' => $service->estimated_minutes,
                'created_at' => now('UTC'),
            ]);
        }
    }

    private function serviceIds(mixed $value): array
    {
        if (! is_array($value)) {
            $value = [$value];
        }

        return array_map(fn ($id) => filter_var($id, FILTER_VALIDATE_INT) ?: 0, $value);
    }

    private function bookingsPaused(): bool
    {
        return DB::table('app_settings')->where('setting_key', 'booking_enabled')->value('setting_value') === 'false';
    }

    private function reference(string $prefix, int $bytes): string
    {
        return $prefix.strtoupper(bin2hex(random_bytes($bytes)));
    }
}
