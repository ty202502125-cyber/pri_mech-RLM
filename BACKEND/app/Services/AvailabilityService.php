<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

class AvailabilityService
{
    public function timezone(): string
    {
        return (string) env('WORKSHOP_TIME_ZONE', 'Asia/Manila');
    }

    public function mysqlDateTime(DateTimeInterface $value): string
    {
        return CarbonImmutable::instance($value)->utc()->format('Y-m-d H:i:s');
    }

    public function dateAtWorkshopTime(string $date, int $minute): CarbonImmutable
    {
        $wallTime = CarbonImmutable::parse($date, $this->timezone())->startOfDay()->addMinutes($minute);

        return $wallTime->utc();
    }

    public function dateBounds(DateTimeInterface|string $value): array
    {
        $date = is_string($value)
            ? $value
            : CarbonImmutable::instance($value)->setTimezone($this->timezone())->format('Y-m-d');
        $startLocal = CarbonImmutable::parse($date, $this->timezone())->startOfDay();

        return [
            'date' => $date,
            'start' => $startLocal->utc(),
            'end' => $startLocal->addDay()->utc(),
        ];
    }

    public function serviceDuration(array $serviceIds): ?int
    {
        if ($serviceIds === []) {
            return null;
        }

        $services = DB::table('services')
            ->where('is_active', 1)
            ->whereIn('id', $serviceIds)
            ->get(['id', 'estimated_minutes']);

        if ($services->count() !== count($serviceIds)) {
            return null;
        }

        return (int) $services->sum(fn ($service) => (int) $service->estimated_minutes);
    }

    public function capacityForDate(DateTimeInterface|string $value, ?int $excludeBookingId = null): array
    {
        ['date' => $date, 'start' => $start, 'end' => $end] = $this->dateBounds($value);
        $day = CarbonImmutable::parse($date, $this->timezone())->dayOfWeek;
        $schedule = DB::table('availability_schedules')->where('day_of_week', $day)->first();

        if (! $schedule || ! $schedule->is_working_day || ! $schedule->opens_at || ! $schedule->closes_at) {
            return [
                'date' => $date,
                'status' => 'closed',
                'dailyCapacityMinutes' => 0,
                'reservedMinutes' => 0,
                'remainingMinutes' => 0,
                'schedule' => $schedule,
            ];
        }

        $closure = DB::table('unavailable_dates')
            ->where('starts_at', '<', $this->mysqlDateTime($end))
            ->where('ends_at', '>', $this->mysqlDateTime($start))
            ->exists();

        if ($closure) {
            return [
                'date' => $date,
                'status' => 'unavailable',
                'dailyCapacityMinutes' => (int) $schedule->daily_capacity_minutes,
                'reservedMinutes' => 0,
                'remainingMinutes' => 0,
                'schedule' => $schedule,
            ];
        }

        $bookings = $this->dailyBookings($start, $end, $excludeBookingId);
        $reservedMinutes = (int) $bookings->sum(fn ($booking) => (int) $booking->duration_minutes);
        $dailyCapacityMinutes = (int) $schedule->daily_capacity_minutes;
        $remainingMinutes = max(0, $dailyCapacityMinutes - $reservedMinutes);

        return [
            'date' => $date,
            'status' => $remainingMinutes === 0
                ? 'fully_booked'
                : ($reservedMinutes > 0 ? 'limited_availability' : 'available'),
            'dailyCapacityMinutes' => $dailyCapacityMinutes,
            'reservedMinutes' => $reservedMinutes,
            'remainingMinutes' => $remainingMinutes,
            'schedule' => $schedule,
        ];
    }

    public function slotCheck(
        DateTimeInterface|string $startAt,
        int $durationMinutes,
        ?int $excludeBookingId = null,
        bool $lockSchedule = false,
    ): array {
        $startAt = $startAt instanceof DateTimeInterface
            ? CarbonImmutable::instance($startAt)->utc()
            : CarbonImmutable::parse($startAt)->utc();
        ['date' => $date] = $this->dateBounds($startAt);
        $day = CarbonImmutable::parse($date, $this->timezone())->dayOfWeek;
        $scheduleQuery = DB::table('availability_schedules')
            ->where('day_of_week', $day)
            ->select('is_working_day', 'opens_at', 'closes_at', 'break_starts_at', 'break_ends_at', 'slot_minutes', 'daily_capacity_minutes', 'max_dropoffs_per_slot');

        if ($lockSchedule) {
            $scheduleQuery->lockForUpdate();
        }

        $schedule = $scheduleQuery->first();

        if (! $schedule || ! $schedule->is_working_day || ! $schedule->opens_at || ! $schedule->closes_at) {
            return ['available' => false, 'reason' => 'The workshop is not open on that day.'];
        }

        $localStart = $startAt->setTimezone($this->timezone());
        $startMinute = ($localStart->hour * 60) + $localStart->minute;
        $openMinute = $this->minuteOfDay($schedule->opens_at);
        $closeMinute = $this->minuteOfDay($schedule->closes_at);

        if ($startMinute < $openMinute || $startMinute >= $closeMinute) {
            return ['available' => false, 'reason' => 'The requested drop-off time falls outside workshop hours.'];
        }

        $interval = (int) $schedule->slot_minutes;

        if (($startMinute - $openMinute) % $interval !== 0) {
            return ['available' => false, 'reason' => 'Choose a drop-off time that matches the configured appointment interval.'];
        }

        if ($schedule->break_starts_at && $schedule->break_ends_at
            && $startMinute >= $this->minuteOfDay($schedule->break_starts_at)
            && $startMinute < $this->minuteOfDay($schedule->break_ends_at)) {
            return ['available' => false, 'reason' => 'The requested drop-off time falls during the workshop break.'];
        }

        $startSql = $this->mysqlDateTime($startAt);
        $closure = DB::table('unavailable_dates')
            ->where('starts_at', '<=', $startSql)
            ->where('ends_at', '>', $startSql)
            ->exists();

        if ($closure) {
            return ['available' => false, 'reason' => 'The workshop is unavailable at that drop-off time.'];
        }

        $slotStartMinute = $openMinute + (int) (floor(($startMinute - $openMinute) / $interval) * $interval);
        $slotStart = $this->dateAtWorkshopTime($date, $slotStartMinute);
        $slotEnd = $this->dateAtWorkshopTime($date, $slotStartMinute + $interval);
        $dropoffs = $this->reservedBookings()
            ->whereBetween('scheduled_at', [$this->mysqlDateTime($slotStart), $this->mysqlDateTime($slotEnd)])
            ->where('scheduled_at', '<', $this->mysqlDateTime($slotEnd))
            ->when($excludeBookingId, fn ($query) => $query->where('id', '<>', $excludeBookingId))
            ->count();

        if ($dropoffs >= (int) $schedule->max_dropoffs_per_slot) {
            return ['available' => false, 'reason' => 'That drop-off time has reached its bicycle limit.'];
        }

        $capacity = $this->capacityForDate($startAt, $excludeBookingId);

        if (in_array($capacity['status'], ['unavailable', 'closed'], true)) {
            return ['available' => false, 'reason' => 'The workshop is unavailable on that date.'];
        }

        if ($durationMinutes > $capacity['remainingMinutes']) {
            return ['available' => false, 'reason' => "Only {$capacity['remainingMinutes']} minutes of repair capacity remain on that date."];
        }

        return ['available' => true, 'schedule' => $schedule, 'capacity' => $capacity];
    }

    private function dailyBookings(CarbonImmutable $start, CarbonImmutable $end, ?int $excludeBookingId)
    {
        return $this->reservedBookings()
            ->join('services as s', 's.id', '=', 'bookings.service_id')
            ->where('bookings.scheduled_at', '>=', $this->mysqlDateTime($start))
            ->where('bookings.scheduled_at', '<', $this->mysqlDateTime($end))
            ->when($excludeBookingId, fn ($query) => $query->where('bookings.id', '<>', $excludeBookingId))
            ->selectRaw('bookings.id, bookings.scheduled_at, bookings.status,
                COALESCE(NULLIF((SELECT SUM(bs.duration_snapshot) FROM booking_services bs WHERE bs.booking_id = bookings.id), 0),
                    s.estimated_minutes, 60) AS duration_minutes')
            ->get();
    }

    private function reservedBookings()
    {
        return DB::table('bookings')
            ->where(function ($query): void {
                $query->whereIn('status', ['confirmed', 'in_progress', 'completed', 'payment_submitted'])
                    ->orWhere(function ($query): void {
                        $query->where('status', 'awaiting_payment')
                            ->whereRaw('reservation_expires_at > UTC_TIMESTAMP()');
                    });
            });
    }

    private function minuteOfDay(string $value): int
    {
        [$hours, $minutes] = array_map('intval', explode(':', substr($value, 0, 5)));

        return ($hours * 60) + $minutes;
    }
}
