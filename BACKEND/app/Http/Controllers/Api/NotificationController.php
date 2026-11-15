<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class NotificationController extends Controller
{
    public function announcements(): JsonResponse
    {
        return response()->json(['announcements' => DB::table('announcements')->where('is_published', 1)
            ->orderByRaw('COALESCE(event_at, created_at) DESC')->limit(50)
            ->get(['id', 'title', 'body', 'event_at', 'created_at'])]);
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['notifications' => DB::table('notifications')
            ->where('user_id', $request->user()->id)->orderByDesc('created_at')->limit(100)
            ->get(['id', 'type', 'title', 'body', 'related_booking_id', 'read_at', 'created_at'])]);
    }

    public function readAll(Request $request): JsonResponse
    {
        DB::table('notifications')->where('user_id', $request->user()->id)->whereNull('read_at')->update(['read_at' => now('UTC')]);

        return response()->json(['message' => 'Notifications marked as read.']);
    }

    public function read(Request $request, int $id): JsonResponse
    {
        $updated = DB::table('notifications')->where('id', $id)->where('user_id', $request->user()->id)
            ->whereNull('read_at')->update(['read_at' => now('UTC')]);
        if (! $updated && ! DB::table('notifications')->where('id', $id)->where('user_id', $request->user()->id)->exists()) {
            return response()->json(['error' => 'Notification not found.'], 404);
        }

        return response()->json(['message' => 'Notification marked as read.']);
    }
}
