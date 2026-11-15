<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CustomerController extends Controller
{
    public function profile(Request $request): JsonResponse
    {
        $profile = DB::table('users as u')
            ->leftJoin('customer_profiles as p', 'p.user_id', '=', 'u.id')
            ->where('u.id', $request->user()->id)
            ->first(['u.id', 'u.full_name', 'u.email', 'p.phone', 'p.address', 'p.profile_image_url']);

        return response()->json(['profile' => $profile]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $fullName = trim((string) $request->input('fullName', ''));
        $phone = trim((string) $request->input('phone', '')) ?: null;
        $address = trim((string) $request->input('address', '')) ?: null;

        if (mb_strlen($fullName) < 2 || mb_strlen($fullName) > 120
            || ($phone && mb_strlen($phone) > 32) || ($address && mb_strlen($address) > 500)) {
            return response()->json(['error' => 'Check the name, phone number, and address lengths.'], 400);
        }

        DB::transaction(function () use ($request, $fullName, $phone, $address): void {
            DB::table('users')->where('id', $request->user()->id)->update(['full_name' => $fullName]);
            DB::table('customer_profiles')->updateOrInsert(
                ['user_id' => $request->user()->id],
                ['phone' => $phone, 'address' => $address, 'updated_at' => now('UTC')],
            );
        });

        return response()->json(['profile' => [
            'id' => $request->user()->id,
            'full_name' => $fullName,
            'email' => $request->user()->email,
            'phone' => $phone,
            'address' => $address,
        ]]);
    }

    public function bicycles(Request $request): JsonResponse
    {
        $bicycles = DB::table('bicycles')
            ->where('customer_id', $request->user()->id)
            ->where('is_active', 1)
            ->orderByDesc('created_at')
            ->get(['id', 'brand', 'model', 'category', 'frame_details', 'description', 'created_at', 'updated_at']);

        return response()->json(['bicycles' => $bicycles]);
    }

    public function createBicycle(Request $request): JsonResponse
    {
        $fields = $this->bicycleFields($request);

        if (isset($fields['error'])) {
            return response()->json(['error' => $fields['error']], 400);
        }

        $id = DB::table('bicycles')->insertGetId([
            'customer_id' => $request->user()->id,
            ...$fields,
            'is_active' => true,
            'created_at' => now('UTC'),
            'updated_at' => now('UTC'),
        ]);

        return response()->json(['bicycle' => [
            'id' => $id,
            'brand' => $fields['brand'],
            'model' => $fields['model'],
            'category' => $fields['category'],
            'frame_details' => $fields['frame_details'],
            'description' => $fields['description'],
        ]], 201);
    }

    public function updateBicycle(Request $request, int $id): JsonResponse
    {
        $fields = $this->bicycleFields($request);

        if (isset($fields['error'])) {
            return response()->json(['error' => $fields['error']], 400);
        }

        $updated = DB::table('bicycles')
            ->where('id', $id)
            ->where('customer_id', $request->user()->id)
            ->where('is_active', 1)
            ->update([...$fields, 'updated_at' => now('UTC')]);

        if (! $updated) {
            $exists = DB::table('bicycles')->where('id', $id)->where('customer_id', $request->user()->id)->exists();

            if (! $exists) {
                return response()->json(['error' => 'Bicycle not found.'], 404);
            }
        }

        return response()->json(['message' => 'Bicycle updated.']);
    }

    public function deleteBicycle(Request $request, int $id): JsonResponse
    {
        $updated = DB::table('bicycles')
            ->where('id', $id)
            ->where('customer_id', $request->user()->id)
            ->where('is_active', 1)
            ->update(['is_active' => false, 'updated_at' => now('UTC')]);

        if (! $updated) {
            return response()->json(['error' => 'Bicycle not found.'], 404);
        }

        return response()->json(['message' => 'Bicycle removed from your active list.']);
    }

    public function location(Request $request, int $id): JsonResponse
    {
        $booking = DB::table('bookings as b')
            ->leftJoin('payments as p', 'p.booking_id', '=', 'b.id')
            ->where('b.id', $id)
            ->where('b.customer_id', $request->user()->id)
            ->first(['b.status', 'p.status as payment_status']);

        if (! $booking) {
            return response()->json(['error' => 'Booking not found.'], 404);
        }

        if ($booking->payment_status !== 'paid' || ! in_array($booking->status, ['confirmed', 'in_progress', 'completed'], true)) {
            return response()->json(['error' => 'The workshop address is available after the mechanic verifies full payment.'], 403);
        }

        $address = DB::table('app_settings')->where('setting_key', 'workshop_address')->value('setting_value');

        if (! $address) {
            return response()->json(['error' => 'The workshop address has not been configured yet.'], 503);
        }

        return response()->json(['address' => $address])->header('Cache-Control', 'private, no-store');
    }

    public function createReview(Request $request, int $id): JsonResponse
    {
        $rating = filter_var($request->input('rating'), FILTER_VALIDATE_INT);
        $comment = trim((string) $request->input('comment', ''));

        if ($rating === false || $rating < 1 || $rating > 5) {
            return response()->json(['error' => 'Choose a star rating from 1 to 5.'], 400);
        }

        if (mb_strlen($comment) < 3 || mb_strlen($comment) > 1500) {
            return response()->json(['error' => 'Write a comment between 3 and 1,500 characters.'], 400);
        }

        $completed = DB::table('bookings')
            ->where('id', $id)
            ->where('customer_id', $request->user()->id)
            ->where('status', 'completed')
            ->exists();

        if (! $completed) {
            return response()->json(['error' => 'Reviews are available after the mechanic marks your booking complete.'], 409);
        }

        try {
            DB::table('customer_reviews')->insert([
                'booking_id' => $id,
                'customer_id' => $request->user()->id,
                'rating' => $rating,
                'comment' => $comment,
                'is_anonymous' => $request->boolean('anonymous'),
                'created_at' => now('UTC'),
                'updated_at' => now('UTC'),
            ]);
        } catch (QueryException $exception) {
            if (($exception->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'You already reviewed this completed service.'], 409);
            }

            throw $exception;
        }

        return response()->json(['message' => 'Thanks for sharing feedback about your completed service.'], 201);
    }

    private function bicycleFields(Request $request): array
    {
        $fields = [
            'brand' => trim((string) $request->input('brand', '')) ?: null,
            'model' => trim((string) $request->input('model', '')) ?: null,
            'category' => trim((string) $request->input('category', '')),
            'frame_details' => trim((string) $request->input('frameDetails', '')) ?: null,
            'description' => trim((string) $request->input('description', '')) ?: null,
        ];

        if (mb_strlen($fields['category']) < 2 || mb_strlen($fields['category']) > 80
            || ($fields['brand'] && mb_strlen($fields['brand']) > 100)
            || ($fields['model'] && mb_strlen($fields['model']) > 100)
            || ($fields['frame_details'] && mb_strlen($fields['frame_details']) > 160)
            || ($fields['description'] && mb_strlen($fields['description']) > 1000)) {
            return ['error' => 'Check the bicycle category and field lengths.'];
        }

        return $fields;
    }
}
