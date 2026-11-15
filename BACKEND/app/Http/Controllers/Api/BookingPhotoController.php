<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\PrivateFileService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BookingPhotoController extends Controller
{
    public function index(Request $request, int $id): JsonResponse
    {
        $booking = DB::table('bookings')->where('id', $id)->first(['customer_id']);
        if (! $booking || ($request->user()->role !== 'admin' && (int) $booking->customer_id !== (int) $request->user()->id)) {
            return response()->json(['error' => 'Booking photos not found.'], 404);
        }

        return response()->json(['photos' => DB::table('booking_photos')->where('booking_id', $id)
            ->orderBy('created_at')->get(['id', 'content_type', 'file_size', 'created_at'])])
            ->header('Cache-Control', 'private, no-store');
    }

    public function store(Request $request, int $id, PrivateFileService $files): JsonResponse
    {
        if ($request->user()->role !== 'customer') {
            return response()->json(['error' => 'Customer account required.'], 403);
        }

        $file = $files->parseBicyclePhoto($request->input('photoData'));
        if (! $file) {
            return response()->json(['error' => 'Upload a valid JPEG, PNG, or WebP bicycle photo no larger than 10 MB.'], 400);
        }

        $filename = null;
        try {
            $photoId = DB::transaction(function () use ($request, $id, $files, $file, &$filename): int {
                $booking = DB::table('bookings')->where('id', $id)->where('customer_id', $request->user()->id)
                    ->where('status', 'pending_review')->lockForUpdate()->first(['id']);
                if (! $booking) {
                    throw new DomainException('An editable booking request was not found.', 404);
                }

                if (DB::table('booking_photos')->where('booking_id', $id)->count() >= 3) {
                    throw new DomainException('A bicycle can have up to three photos.', 409);
                }

                $filename = $files->save($file, 'bicycle-photos');

                return DB::table('booking_photos')->insertGetId([
                    'booking_id' => $id,
                    'file_name' => $filename,
                    'content_type' => $file['contentType'],
                    'file_size' => strlen($file['contents']),
                    'created_at' => now('UTC'),
                ]);
            }, 3);
        } catch (DomainException $exception) {
            if ($filename) {
                $files->delete('bicycle-photos', $filename);
            }

            return response()->json(['error' => $exception->getMessage()], $exception->getCode());
        } catch (\Throwable $exception) {
            if ($filename) {
                $files->delete('bicycle-photos', $filename);
            }
            throw $exception;
        }

        return response()->json(['photo' => ['id' => $photoId], 'message' => 'Bicycle photo uploaded.'], 201);
    }

    public function show(Request $request, int $id, PrivateFileService $files)
    {
        $photo = DB::table('booking_photos as bp')->join('bookings as b', 'b.id', '=', 'bp.booking_id')
            ->where('bp.id', $id)->first(['bp.file_name', 'bp.content_type', 'b.customer_id']);
        if (! $photo || ($request->user()->role !== 'admin' && (int) $photo->customer_id !== (int) $request->user()->id)) {
            return response()->json(['error' => 'Bicycle photo not found.'], 404);
        }

        $path = $files->path('bicycle-photos', $photo->file_name);
        if (! is_file($path)) {
            return response()->json(['error' => 'Bicycle photo file is unavailable.'], 404);
        }

        return response()->file($path, [
            'Content-Type' => $photo->content_type,
            'Content-Disposition' => 'inline; filename="'.basename($photo->file_name).'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
