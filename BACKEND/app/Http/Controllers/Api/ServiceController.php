<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AvailabilityService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ServiceController extends Controller
{
    public function index(): JsonResponse
    {
        $services = DB::table('services')
            ->where('is_active', 1)
            ->orderBy('name')
            ->get(['id', 'name', 'description', 'starting_price', 'estimated_minutes', 'requires_inspection']);

        return response()->json(['services' => $services]);
    }

    public function bookingStatus(): JsonResponse
    {
        $setting = DB::table('app_settings')->where('setting_key', 'booking_enabled')->value('setting_value');

        return response()->json(['enabled' => $setting !== 'false']);
    }

    public function schedules(): JsonResponse
    {
        $schedules = DB::table('availability_schedules')
            ->orderBy('day_of_week')
            ->get(['day_of_week', 'is_working_day', 'opens_at', 'closes_at', 'break_starts_at', 'break_ends_at', 'slot_minutes', 'daily_capacity_minutes', 'max_dropoffs_per_slot']);

        return response()->json(['schedules' => $schedules]);
    }

    public function availability(Request $request, AvailabilityService $availability): JsonResponse
    {
        $date = (string) $request->query('date', '');
        $parsedDate = CarbonImmutable::hasFormat($date, 'Y-m-d') ? CarbonImmutable::createFromFormat('Y-m-d', $date) : false;

        if (! $parsedDate || $parsedDate->format('Y-m-d') !== $date) {
            return response()->json(['error' => 'Choose a valid date in YYYY-MM-DD format.'], 400);
        }

        $rawIds = (string) ($request->query('serviceIds') ?? $request->query('serviceId', ''));
        $serviceIds = $rawIds === '' ? [] : array_map('intval', explode(',', $rawIds));

        if (count($serviceIds) > 10 || in_array(0, $serviceIds, true)
            || count(array_unique($serviceIds)) !== count($serviceIds)) {
            return response()->json(['error' => 'Choose up to ten different active services.'], 400);
        }

        $duration = $availability->serviceDuration($serviceIds);

        if ($serviceIds !== [] && $duration === null) {
            return response()->json(['error' => 'One or more selected services are unavailable.'], 400);
        }

        $capacity = $availability->capacityForDate($date);

        if (in_array($capacity['status'], ['closed', 'unavailable'], true)) {
            return response()->json($capacity + [
                'durationMinutes' => $duration,
                'slots' => [],
                'reason' => $capacity['status'] === 'closed'
                    ? 'The workshop is not open on that day.'
                    : 'The workshop is unavailable on that date.',
            ]);
        }

        $schedule = $capacity['schedule'];
        $interval = (int) $schedule->slot_minutes;
        $length = $duration ?? $interval;

        if ($length > 1440) {
            return response()->json(['error' => 'The combined service duration is too long for one booking.'], 400);
        }

        $open = $this->minuteOfDay($schedule->opens_at);
        $close = $this->minuteOfDay($schedule->closes_at);
        $slots = [];

        for ($minute = $open; $minute < $close; $minute += $interval) {
            $startAt = $availability->dateAtWorkshopTime($date, $minute);

            if ($startAt->lessThanOrEqualTo(CarbonImmutable::now('UTC'))) {
                continue;
            }

            $result = $availability->slotCheck($startAt, $length);

            if ($result['available']) {
                $slots[] = ['startsAt' => $startAt->toISOString(), 'durationMinutes' => $length];
            }
        }

        return response()->json($capacity + ['durationMinutes' => $length, 'slots' => $slots]);
    }

    private function minuteOfDay(string $value): int
    {
        [$hours, $minutes] = array_map('intval', explode(':', substr($value, 0, 5)));

        return ($hours * 60) + $minutes;
    }
}
