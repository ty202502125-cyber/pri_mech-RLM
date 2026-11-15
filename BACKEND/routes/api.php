<?php

use App\Http\Controllers\Api\AdminContentController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\BookingPhotoController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\PublicContentController;
use App\Http\Controllers\Api\RepairController;
use App\Http\Controllers\Api\ServiceController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    try {
        DB::connection()->select('SELECT 1');

        return response()->json([
            'status' => 'ok',
            'service' => 'bicycle-mechanic-api',
            'database' => 'connected',
        ]);
    } catch (Throwable $exception) {
        report($exception);

        return response()->json([
            'status' => 'error',
            'service' => 'bicycle-mechanic-api',
            'database' => 'unavailable',
        ], 503);
    }
});

Route::get('/services', [ServiceController::class, 'index']);
Route::get('/booking-status', [ServiceController::class, 'bookingStatus']);
Route::get('/availability/schedules', [ServiceController::class, 'schedules']);
Route::get('/availability', [ServiceController::class, 'availability']);
Route::get('/mechanic-profile', [PublicContentController::class, 'mechanicProfile']);
Route::get('/profile', [PublicContentController::class, 'mechanicProfile']);
Route::get('/builds', [PublicContentController::class, 'builds']);
Route::get('/certifications', [PublicContentController::class, 'certifications']);
Route::get('/reviews', [PublicContentController::class, 'reviews']);

Route::prefix('auth')->middleware('throttle:30,15')->group(function (): void {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/forgot-password', [AuthController::class, 'forgotPassword']);
    Route::post('/reset-password', [AuthController::class, 'resetPassword']);
    Route::get('/me', [AuthController::class, 'me'])->middleware('auth:sanctum');
    Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
});

Route::middleware(['auth:sanctum', 'role:customer'])->group(function (): void {
    Route::get('/customers/me', [CustomerController::class, 'profile']);
    Route::put('/customers/me', [CustomerController::class, 'updateProfile']);
    Route::get('/bicycles', [CustomerController::class, 'bicycles']);
    Route::post('/bicycles', [CustomerController::class, 'createBicycle']);
    Route::put('/bicycles/{id}', [CustomerController::class, 'updateBicycle'])->whereNumber('id');
    Route::delete('/bicycles/{id}', [CustomerController::class, 'deleteBicycle'])->whereNumber('id');
    Route::get('/bookings/{id}/location', [CustomerController::class, 'location'])->whereNumber('id');
    Route::post('/bookings/{id}/review', [CustomerController::class, 'createReview'])->whereNumber('id');
    Route::get('/bookings/mine', [BookingController::class, 'mine']);
    Route::get('/customers/me/repairs', [RepairController::class, 'mine']);
    Route::get('/customers/me/payments', [PaymentController::class, 'customerPayments']);
    Route::patch('/repairs/{id}/estimate', [RepairController::class, 'respondToEstimate'])->whereNumber('id');
    Route::post('/booking-groups', [BookingController::class, 'createGroup']);
    Route::post('/bookings', [BookingController::class, 'create']);
    Route::patch('/bookings/{id}/cancel', [BookingController::class, 'cancel'])->whereNumber('id');
});

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('/announcements', [NotificationController::class, 'announcements']);
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::patch('/notifications/read-all', [NotificationController::class, 'readAll']);
    Route::patch('/notifications/{id}/read', [NotificationController::class, 'read'])->whereNumber('id');
    Route::get('/bookings/{id}/photos', [BookingPhotoController::class, 'index'])->whereNumber('id');
    Route::post('/bookings/{id}/photos', [BookingPhotoController::class, 'store'])->whereNumber('id');
    Route::get('/booking-photos/{id}', [BookingPhotoController::class, 'show'])->whereNumber('id');
    Route::get('/repairs/{bookingId}', [RepairController::class, 'show'])->whereNumber('bookingId');
    Route::post('/payments', [PaymentController::class, 'submit']);
    Route::post('/booking-groups/{id}/payments', [PaymentController::class, 'submitGroup'])->whereNumber('id');
    Route::get('/payments/transactions/{id}/proof', [PaymentController::class, 'proof'])->whereNumber('id');
    Route::get('/booking-group-payments/{id}/proof', [PaymentController::class, 'proofGroup'])->whereNumber('id');
});

Route::middleware(['auth:sanctum', 'role:admin'])->group(function (): void {
    Route::put('/admin/mechanic-profile', [AdminContentController::class, 'saveMechanicProfile']);
    Route::get('/payments', [PaymentController::class, 'adminPayments']);
    Route::get('/booking-group-payments', [PaymentController::class, 'groupPayments']);
    Route::patch('/payments/transactions/{id}/verify', [PaymentController::class, 'verify'])->whereNumber('id');
    Route::patch('/payments/transactions/{id}/reject', [PaymentController::class, 'reject'])->whereNumber('id');
    Route::post('/payments/transactions/{id}/refund', [PaymentController::class, 'refund'])->whereNumber('id');
    Route::patch('/booking-group-payments/{id}/verify', [PaymentController::class, 'verifyGroup'])->whereNumber('id');
    Route::patch('/booking-group-payments/{id}/reject', [PaymentController::class, 'rejectGroup'])->whereNumber('id');
    Route::post('/admin/builds', [AdminContentController::class, 'createBuild']);
    Route::put('/admin/builds/{id}', [AdminContentController::class, 'updateBuild'])->whereNumber('id');
    Route::delete('/admin/builds/{id}', [AdminContentController::class, 'deleteBuild'])->whereNumber('id');
    Route::post('/admin/certifications', [AdminContentController::class, 'createCertification']);
    Route::put('/admin/certifications/{id}', [AdminContentController::class, 'updateCertification'])->whereNumber('id');
    Route::delete('/admin/certifications/{id}', [AdminContentController::class, 'deleteCertification'])->whereNumber('id');
});

Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function (): void {
    Route::get('/bookings', [AdminController::class, 'bookings']);
    Route::post('/payments/cash', [PaymentController::class, 'cash']);
    Route::post('/services', [AdminController::class, 'createService']);
    Route::put('/services/{id}', [AdminController::class, 'updateService'])->whereNumber('id');
    Route::delete('/services/{id}', [AdminController::class, 'deleteService'])->whereNumber('id');
    Route::patch('/services/{id}', [AdminController::class, 'toggleService'])->whereNumber('id');
    Route::post('/announcements', [AdminController::class, 'createAnnouncement']);
    Route::delete('/announcements/{id}', [AdminController::class, 'deleteAnnouncement'])->whereNumber('id');
    Route::patch('/bookings/{id}', [AdminController::class, 'updateBooking'])->whereNumber('id');
    Route::get('/analytics', [AdminController::class, 'analytics']);
    Route::get('/services', [AdminController::class, 'adminServices']);
    Route::get('/announcements', [AdminController::class, 'adminAnnouncements']);
    Route::get('/workshop-location', [AdminController::class, 'workshopLocation']);
    Route::put('/workshop-location', [AdminController::class, 'saveWorkshopLocation']);
    Route::post('/work-sessions/start', [AdminController::class, 'startWorkSession']);
    Route::post('/work-sessions/stop', [AdminController::class, 'stopWorkSession']);
    Route::put('/booking-mode', [AdminController::class, 'bookingMode']);
    Route::put('/availability/schedules/{dayOfWeek}', [AdminController::class, 'updateSchedule'])->whereNumber('dayOfWeek');
    Route::get('/availability/unavailable-dates', [AdminController::class, 'unavailableDates']);
    Route::post('/availability/unavailable-dates', [AdminController::class, 'createUnavailableDate']);
    Route::delete('/availability/unavailable-dates/{id}', [AdminController::class, 'deleteUnavailableDate'])->whereNumber('id');
});

Route::middleware(['auth:sanctum', 'role:admin'])->group(function (): void {
    Route::post('/repairs/{bookingId}', [RepairController::class, 'create'])->whereNumber('bookingId');
    Route::put('/repairs/{id}', [RepairController::class, 'update'])->whereNumber('id');
});
