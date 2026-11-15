<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AvailabilityService;
use App\Services\BookingWorkflowService;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AdminController extends Controller
{
    public function bookings(): JsonResponse
    {
        $bookings = DB::table('bookings as b')
            ->join('users as u', 'u.id', '=', 'b.customer_id')
            ->join('services as s', 's.id', '=', 'b.service_id')
            ->leftJoin('booking_groups as bg', 'bg.id', '=', 'b.booking_group_id')
            ->orderByRaw("FIELD(b.status, 'pending_review', 'awaiting_customer_response', 'confirmed', 'rejected', 'cancelled', 'completed')")
            ->orderByDesc('b.created_at')
            ->selectRaw("b.id, b.booking_ref, b.bicycle_type, b.bicycle_brand, b.bicycle_model,
                b.problem_description, b.preferred_at, b.scheduled_at, b.status, b.admin_note, b.created_at,
                bg.group_ref, bg.payment_choice,
                (SELECT COUNT(*) FROM booking_photos bp WHERE bp.booking_id = b.id) AS photo_count,
                u.full_name AS customer_name, u.email AS customer_email,
                COALESCE((SELECT GROUP_CONCAT(ss.name ORDER BY ss.name SEPARATOR ', ') FROM booking_services bs
                    JOIN services ss ON ss.id = bs.service_id WHERE bs.booking_id = b.id), s.name) AS service_name")
            ->get();

        return response()->json(['bookings' => $bookings]);
    }

    public function updateBooking(Request $request, int $id, AvailabilityService $availability, BookingWorkflowService $workflow): JsonResponse
    {
        $status = (string) $request->input('status', '');
        $allowed = ['awaiting_payment', 'awaiting_customer_response', 'awaiting_customer', 'rejected', 'cancelled', 'no_show', 'in_progress', 'completed'];

        if (! in_array($status, $allowed, true)) {
            return response()->json(['error' => 'Choose an allowed job status.'], 400);
        }

        $scheduledAt = null;
        if ($request->filled('scheduledAt')) {
            try {
                $scheduledAt = CarbonImmutable::parse((string) $request->input('scheduledAt'))->utc();
            } catch (\Throwable) {
                return response()->json(['error' => 'Choose a valid appointment time.'], 400);
            }
        }

        if ($status === 'awaiting_payment' && (! $scheduledAt || $scheduledAt->lessThanOrEqualTo(CarbonImmutable::now('UTC')))) {
            return response()->json(['error' => 'Set a future proposed drop-off time before approving the booking.'], 400);
        }

        $adminNote = mb_substr(trim((string) $request->input('adminNote', '')), 0, 1000) ?: null;

        try {
            DB::transaction(function () use ($id, $status, $scheduledAt, $adminNote, $request, $availability, $workflow): void {
                $booking = DB::table('bookings')->where('id', $id)->lockForUpdate()->first(['status']);
                if (! $booking) {
                    throw new DomainException('Booking not found.', 404);
                }

                $workflow->recordTransition($id, $booking->status, $status, (int) $request->user()->id, 'admin', $adminNote);

                if ($status === 'awaiting_payment') {
                    $duration = (int) DB::table('booking_services')
                        ->where('booking_id', $id)->sum('duration_snapshot');
                    if ($duration < 1) {
                        $duration = (int) DB::table('bookings as b')
                            ->join('services as s', 's.id', '=', 'b.service_id')
                            ->where('b.id', $id)->value('s.estimated_minutes') ?: 60;
                    }
                    if ($duration > 1440) {
                        throw new DomainException('The combined service duration exceeds one day.', 409);
                    }

                    $slot = $availability->slotCheck($scheduledAt, $duration, $id, true);
                    if (! $slot['available']) {
                        throw new DomainException($slot['reason'], 409);
                    }

                    $estimatedAmount = (float) DB::table('booking_services')->where('booking_id', $id)->sum('unit_price_snapshot');
                    if ($estimatedAmount <= 0) {
                        $estimatedAmount = (float) DB::table('bookings as b')
                            ->join('services as s', 's.id', '=', 'b.service_id')
                            ->where('b.id', $id)->value('s.starting_price') ?: 0;
                    }

                    $payment = DB::table('payments')->where('booking_id', $id)->lockForUpdate()->first(['id', 'estimated_amount']);
                    if (! $payment) {
                        DB::table('payments')->insert([
                            'booking_id' => $id,
                            'estimated_amount' => $estimatedAmount,
                            'status' => 'pending',
                            'created_at' => now('UTC'),
                            'updated_at' => now('UTC'),
                        ]);
                    } elseif ($payment->estimated_amount === null) {
                        DB::table('payments')->where('id', $payment->id)->update([
                            'estimated_amount' => $estimatedAmount,
                            'updated_at' => now('UTC'),
                        ]);
                    }
                }

                DB::table('bookings')->where('id', $id)->update([
                    'status' => $status,
                    'scheduled_at' => $status === 'awaiting_payment' ? $availability->mysqlDateTime($scheduledAt) : DB::raw('scheduled_at'),
                    'reservation_expires_at' => $status === 'awaiting_payment' ? now('UTC')->addHours(2) : null,
                    'admin_note' => $adminNote,
                    'updated_at' => now('UTC'),
                ]);
            }, 3);
        } catch (DomainException $exception) {
            return response()->json(['error' => $exception->getMessage()], $exception->getCode() === 404 ? 404 : 409);
        }

        return response()->json(['message' => 'Booking updated.']);
    }

    public function schedules(): JsonResponse
    {
        return response()->json(['schedules' => DB::table('availability_schedules')->orderBy('day_of_week')->get()]);
    }

    public function updateSchedule(Request $request, int $dayOfWeek): JsonResponse
    {
        $isWorkingDay = $request->boolean('isWorkingDay');
        $opensAt = $request->input('opensAt') ?: null;
        $closesAt = $request->input('closesAt') ?: null;
        $breakStartsAt = $request->input('breakStartsAt') ?: null;
        $breakEndsAt = $request->input('breakEndsAt') ?: null;
        $slotMinutes = filter_var($request->input('slotMinutes'), FILTER_VALIDATE_INT);
        $dailyCapacity = filter_var($request->input('dailyCapacityMinutes', 600), FILTER_VALIDATE_INT);
        $maxDropoffs = filter_var($request->input('maxDropoffsPerSlot', 1), FILTER_VALIDATE_INT);
        $timeValid = fn ($value) => $value === null || preg_match('/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', (string) $value);
        $toMinutes = fn ($value) => $value ? ((int) substr($value, 0, 2) * 60) + (int) substr($value, 3, 2) : 0;
        $workMinutes = $opensAt && $closesAt
            ? $toMinutes($closesAt) - $toMinutes($opensAt) - (($breakStartsAt && $breakEndsAt) ? $toMinutes($breakEndsAt) - $toMinutes($breakStartsAt) : 0)
            : 0;

        if ($dayOfWeek < 0 || $dayOfWeek > 6 || $slotMinutes === false || $slotMinutes < 15 || $slotMinutes > 1440
            || $dailyCapacity === false || $dailyCapacity < 1 || $dailyCapacity > 1440
            || $maxDropoffs === false || $maxDropoffs < 1 || $maxDropoffs > 100
            || ! $timeValid($opensAt) || ! $timeValid($closesAt) || ! $timeValid($breakStartsAt) || ! $timeValid($breakEndsAt)
            || ($isWorkingDay && (! $opensAt || ! $closesAt || $opensAt >= $closesAt))
            || (bool) $breakStartsAt !== (bool) $breakEndsAt
            || ($breakStartsAt && ($breakStartsAt >= $breakEndsAt || $breakStartsAt < $opensAt || $breakEndsAt > $closesAt))
            || ($isWorkingDay && $dailyCapacity > $workMinutes)) {
            return response()->json(['error' => 'Check the working hours, break, capacity, drop-off limit, and slot interval.'], 400);
        }

        DB::table('availability_schedules')->updateOrInsert(
            ['day_of_week' => $dayOfWeek],
            [
                'is_working_day' => $isWorkingDay,
                'opens_at' => $opensAt,
                'closes_at' => $closesAt,
                'break_starts_at' => $breakStartsAt,
                'break_ends_at' => $breakEndsAt,
                'slot_minutes' => $slotMinutes,
                'daily_capacity_minutes' => $dailyCapacity,
                'max_dropoffs_per_slot' => $maxDropoffs,
                'updated_at' => now('UTC'),
            ],
        );
        $this->audit((int) $request->user()->id, 'availability.schedule_updated', 'availability_schedule', (string) $dayOfWeek);

        return response()->json(['message' => 'Weekly schedule saved.']);
    }

    public function unavailableDates(): JsonResponse
    {
        return response()->json(['unavailableDates' => DB::table('unavailable_dates')->orderBy('starts_at')->get(['id', 'starts_at', 'ends_at', 'reason', 'created_at'])]);
    }

    public function createUnavailableDate(Request $request, AvailabilityService $availability): JsonResponse
    {
        try {
            $start = CarbonImmutable::parse((string) $request->input('startsAt'))->utc();
            $end = CarbonImmutable::parse((string) $request->input('endsAt'))->utc();
        } catch (\Throwable) {
            return response()->json(['error' => 'Choose a valid start and end time for the closure.'], 400);
        }

        if (! $start->lessThan($end)) {
            return response()->json(['error' => 'Choose a valid start and end time for the closure.'], 400);
        }

        $reason = mb_substr(trim((string) $request->input('reason', '')), 0, 500) ?: null;
        $id = DB::transaction(function () use ($start, $end, $reason, $request, $availability): int {
            foreach ($this->weekdaysTouched($start, $end) as $day) {
                DB::table('availability_schedules')->where('day_of_week', $day)->lockForUpdate()->first(['id']);
            }
            $id = DB::table('unavailable_dates')->insertGetId([
                'starts_at' => $availability->mysqlDateTime($start),
                'ends_at' => $availability->mysqlDateTime($end),
                'reason' => $reason,
                'created_by' => $request->user()->id,
                'created_at' => now('UTC'),
            ]);
            $this->audit((int) $request->user()->id, 'availability.closure_created', 'unavailable_date', (string) $id,
                ['startsAt' => $availability->mysqlDateTime($start), 'endsAt' => $availability->mysqlDateTime($end), 'reason' => $reason]);

            return $id;
        });

        return response()->json(['id' => $id, 'message' => 'Unavailable time saved.'], 201);
    }

    public function deleteUnavailableDate(int $id): JsonResponse
    {
        $deleted = DB::transaction(function () use ($id): bool {
            $closure = DB::table('unavailable_dates')->where('id', $id)->lockForUpdate()->first(['starts_at', 'ends_at']);
            if (! $closure) {
                return false;
            }

            foreach ($this->weekdaysTouched(CarbonImmutable::parse($closure->starts_at, 'UTC'), CarbonImmutable::parse($closure->ends_at, 'UTC')) as $day) {
                DB::table('availability_schedules')->where('day_of_week', $day)->lockForUpdate()->first(['id']);
            }

            DB::table('unavailable_dates')->where('id', $id)->delete();

            return true;
        });

        if (! $deleted) {
            return response()->json(['error' => 'Unavailable date not found.'], 404);
        }

        return response()->json(['message' => 'Unavailable time removed.']);
    }

    public function workshopLocation(): JsonResponse
    {
        return response()->json(['address' => DB::table('app_settings')->where('setting_key', 'workshop_address')->value('setting_value') ?: '']);
    }

    public function saveWorkshopLocation(Request $request): JsonResponse
    {
        $address = trim((string) $request->input('address', ''));
        if (mb_strlen($address) < 10 || mb_strlen($address) > 1000) {
            return response()->json(['error' => 'Enter the complete workshop address (10 to 1,000 characters).'], 400);
        }
        DB::table('app_settings')->updateOrInsert(['setting_key' => 'workshop_address'], ['setting_value' => $address, 'updated_at' => now('UTC')]);
        $this->audit((int) $request->user()->id, 'workshop.location_updated', 'app_setting', 'workshop_address');

        return response()->json(['message' => 'Private workshop address saved.']);
    }

    public function startWorkSession(): JsonResponse
    {
        if (DB::table('work_sessions')->whereNull('ended_at')->exists()) {
            return response()->json(['error' => 'A work session is already running.'], 409);
        }
        $id = DB::table('work_sessions')->insertGetId(['started_at' => now('UTC'), 'created_at' => now('UTC')]);

        return response()->json(['id' => $id, 'message' => 'Work session started.'], 201);
    }

    public function stopWorkSession(): JsonResponse
    {
        $updated = DB::table('work_sessions')->whereNull('ended_at')->update(['ended_at' => now('UTC')]);
        if (! $updated) {
            return response()->json(['error' => 'There is no active work session.'], 409);
        }

        return response()->json(['message' => 'Work session stopped.']);
    }

    public function bookingMode(Request $request): JsonResponse
    {
        $pin = (string) $request->input('pin', '');
        $enabled = $request->boolean('enabled');
        if (! preg_match('/^\d{4,12}$/', $pin)) {
            return response()->json(['error' => 'Enter the 4 to 12 digit emergency PIN.'], 400);
        }

        $hash = DB::table('app_settings')->where('setting_key', 'emergency_pin_hash')->value('setting_value');
        if (! $hash) {
            return response()->json(['error' => 'Emergency PIN is not configured. Set BOOKING_CONTROL_PIN in BACKEND/.env and rerun the admin setup command.'], 503);
        }
        if (! Hash::check($pin, $hash)) {
            return response()->json(['error' => 'Emergency PIN is incorrect.'], 403);
        }

        DB::table('app_settings')->updateOrInsert(['setting_key' => 'booking_enabled'], ['setting_value' => $enabled ? 'true' : 'false', 'updated_at' => now('UTC')]);

        return response()->json(['enabled' => $enabled, 'message' => $enabled ? 'Online bookings are open.' : 'Online bookings are paused.']);
    }

    public function adminServices(): JsonResponse
    {
        return response()->json(['services' => DB::table('services')->orderByDesc('is_active')->orderBy('name')->get()]);
    }

    public function adminAnnouncements(): JsonResponse
    {
        return response()->json(['announcements' => DB::table('announcements')->orderByDesc('created_at')->limit(50)->get(['id', 'title', 'body', 'event_at', 'is_published', 'created_at'])]);
    }

    public function createService(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'min:2', 'max:120'], 'description' => ['required', 'string', 'max:2000'], 'startingPrice' => ['required', 'numeric', 'min:0', 'max:10000000'], 'estimatedMinutes' => ['required', 'integer', 'min:1', 'max:1440'], 'requiresInspection' => ['required', 'boolean']]);
        $id = DB::table('services')->insertGetId(['name' => $data['name'], 'description' => $data['description'], 'starting_price' => $data['startingPrice'], 'estimated_minutes' => $data['estimatedMinutes'], 'requires_inspection' => $data['requiresInspection'], 'is_active' => 1, 'created_at' => now('UTC'), 'updated_at' => now('UTC')]);
        $this->audit((int) $request->user()->id, 'service.created', 'service', (string) $id);

        return response()->json(['id' => $id], 201);
    }

    public function updateService(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'min:2', 'max:120'], 'description' => ['required', 'string', 'max:2000'], 'startingPrice' => ['required', 'numeric', 'min:0', 'max:10000000'], 'estimatedMinutes' => ['required', 'integer', 'min:1', 'max:1440'], 'requiresInspection' => ['required', 'boolean'], 'isActive' => ['required', 'boolean']]);
        $updated = DB::table('services')->where('id', $id)->update(['name' => $data['name'], 'description' => $data['description'], 'starting_price' => $data['startingPrice'], 'estimated_minutes' => $data['estimatedMinutes'], 'requires_inspection' => $data['requiresInspection'], 'is_active' => $data['isActive'], 'updated_at' => now('UTC')]);
        if (! $updated && ! DB::table('services')->where('id', $id)->exists()) {
            return response()->json(['error' => 'Service not found.'], 404);
        }

        return response()->json(['message' => 'Service updated.']);
    }

    public function toggleService(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['isActive' => ['required', 'boolean']]);
        $updated = DB::table('services')->where('id', $id)->update(['is_active' => $data['isActive'], 'updated_at' => now('UTC')]);
        if (! $updated && ! DB::table('services')->where('id', $id)->exists()) {
            return response()->json(['error' => 'Service not found.'], 404);
        }

        return response()->json(['message' => 'Service updated.']);
    }

    public function deleteService(int $id): JsonResponse
    {
        try {
            $deleted = DB::table('services')->where('id', $id)->delete();
        } catch (QueryException $exception) {
            if (($exception->errorInfo[1] ?? null) === 1451) {
                return response()->json(['error' => 'This service is attached to booking history. Hide it instead so past bookings remain intact.'], 409);
            }
            throw $exception;
        }

        return $deleted ? response()->json(['message' => 'Service removed.']) : response()->json(['error' => 'Service not found.'], 404);
    }

    public function createAnnouncement(Request $request): JsonResponse
    {
        $data = $request->validate(['title' => ['required', 'string', 'min:2', 'max:180'], 'body' => ['required', 'string', 'min:2', 'max:10000'], 'eventAt' => ['nullable', 'date']]);
        $id = DB::table('announcements')->insertGetId(['title' => $data['title'], 'body' => $data['body'], 'event_at' => isset($data['eventAt']) ? CarbonImmutable::parse($data['eventAt'])->utc() : null, 'is_published' => 1, 'created_at' => now('UTC')]);

        return response()->json(['id' => $id], 201);
    }

    public function deleteAnnouncement(int $id): JsonResponse
    {
        $updated = DB::table('announcements')->where('id', $id)->update(['is_published' => 0]);

        return $updated ? response()->json(['message' => 'Announcement unpublished.']) : response()->json(['error' => 'Announcement not found.'], 404);
    }

    public function analytics(): JsonResponse
    {
        $totals = DB::selectOne("SELECT
            COALESCE(SUM(status = 'pending_review'), 0) AS pending_total,
            COALESCE(SUM(DATE(created_at) = UTC_DATE()), 0) AS received_today,
            COALESCE(SUM(status IN ('confirmed', 'completed') AND DATE(scheduled_at) = UTC_DATE()), 0) AS appointments_today,
            COALESCE(SUM(status = 'cancelled' AND DATE(updated_at) = UTC_DATE()), 0) AS cancelled_today
            FROM bookings");

        $appointments = DB::table('bookings')->whereIn('status', ['confirmed', 'completed'])->whereNotNull('scheduled_at')
            ->whereDate('scheduled_at', '>=', DB::raw('DATE_SUB(UTC_DATE(), INTERVAL 6 DAY)'))
            ->selectRaw('DATE(scheduled_at) AS day, COUNT(*) AS appointments')->groupByRaw('DATE(scheduled_at)')->get();
        $received = DB::table('bookings')->whereDate('created_at', '>=', DB::raw('DATE_SUB(UTC_DATE(), INTERVAL 6 DAY)'))
            ->selectRaw('DATE(created_at) AS day, COUNT(*) AS received')->groupByRaw('DATE(created_at)')->get();
        $cancelled = DB::table('bookings')->where('status', 'cancelled')->whereDate('updated_at', '>=', DB::raw('DATE_SUB(UTC_DATE(), INTERVAL 6 DAY)'))
            ->selectRaw('DATE(updated_at) AS day, COUNT(*) AS cancelled')->groupByRaw('DATE(updated_at)')->get();

        $days = [];
        for ($offset = 6; $offset >= 0; $offset--) {
            $day = CarbonImmutable::now('UTC')->startOfDay()->subDays($offset)->format('Y-m-d');
            $days[$day] = ['day' => $day, 'appointments' => 0, 'received' => 0, 'cancelled' => 0];
        }
        foreach ($appointments as $row) {
            $key = (string) $row->day;
            if (isset($days[$key])) {
                $days[$key]['appointments'] = (int) $row->appointments;
            }
        }
        foreach ($received as $row) {
            $key = (string) $row->day;
            if (isset($days[$key])) {
                $days[$key]['received'] = (int) $row->received;
            }
        }
        foreach ($cancelled as $row) {
            $key = (string) $row->day;
            if (isset($days[$key])) {
                $days[$key]['cancelled'] = (int) $row->cancelled;
            }
        }

        $popular = DB::query()->fromSub(function ($query): void {
            $query->select('booking_id', 'service_id')->from('booking_services')->union(
                DB::table('bookings')->selectRaw('id AS booking_id, service_id'),
            );
        }, 'selected')
            ->join('services as s', 's.id', '=', 'selected.service_id')
            ->selectRaw('s.name, COUNT(*) AS bookings')
            ->groupBy('s.id', 's.name')->orderByDesc('bookings')->limit(5)->get();

        $hours = DB::selectOne('SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND,
            GREATEST(started_at, UTC_DATE()), LEAST(COALESCE(ended_at, UTC_TIMESTAMP()), DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)))), 0) AS seconds
            FROM work_sessions WHERE started_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)
            AND COALESCE(ended_at, UTC_TIMESTAMP()) > UTC_DATE()');
        $activeSession = DB::table('work_sessions')->whereNull('ended_at')->orderByDesc('started_at')->first(['id', 'started_at']);
        $bookingEnabled = DB::table('app_settings')->where('setting_key', 'booking_enabled')->value('setting_value') !== 'false';

        return response()->json([
            'totals' => [...(array) $totals, 'working_hours_today' => (float) ($hours->seconds ?? 0) / 3600],
            'daily' => array_values($days),
            'popular' => $popular,
            'activeSession' => $activeSession,
            'bookingEnabled' => $bookingEnabled,
        ]);
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

    private function weekdaysTouched(CarbonImmutable $start, CarbonImmutable $end): array
    {
        $days = [];
        $cursor = $start->setTimezone(env('WORKSHOP_TIME_ZONE', 'Asia/Manila'))->startOfDay();
        $last = $end->setTimezone(env('WORKSHOP_TIME_ZONE', 'Asia/Manila'));

        while ($cursor->lessThan($last)) {
            $days[] = $cursor->dayOfWeek;
            $cursor = $cursor->addDay();
        }

        $days = array_values(array_unique($days));
        sort($days);

        return $days;
    }
}
