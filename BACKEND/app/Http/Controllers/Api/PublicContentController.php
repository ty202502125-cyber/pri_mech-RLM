<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class PublicContentController extends Controller
{
    public function mechanicProfile(): JsonResponse
    {
        return response()->json(['profile' => DB::table('mechanic_profile')->where('id', 1)->first()]);
    }

    public function builds(): JsonResponse
    {
        return response()->json(['builds' => DB::table('mechanic_builds')->orderByDesc('created_at')->get(['id', 'title', 'image_url', 'owner_name', 'social_url'])]);
    }

    public function certifications(): JsonResponse
    {
        return response()->json(['certifications' => DB::table('mechanic_certifications')->orderByDesc('created_at')->get(['id', 'body', 'title', 'year', 'image_url'])]);
    }

    public function reviews(): JsonResponse
    {
        $reviews = DB::table('customer_reviews as r')
            ->join('users as u', 'u.id', '=', 'r.customer_id')
            ->join('bookings as b', 'b.id', '=', 'r.booking_id')
            ->join('services as s', 's.id', '=', 'b.service_id')
            ->where('b.status', 'completed')
            ->orderByDesc('r.created_at')
            ->limit(50)
            ->selectRaw("r.id, r.rating, r.comment, r.is_anonymous, r.created_at,
                IF(r.is_anonymous = 1, 'Anonymous rider', u.full_name) AS display_name,
                s.name AS service_name")
            ->get();
        $summary = DB::table('customer_reviews as r')->join('bookings as b', 'b.id', '=', 'r.booking_id')
            ->where('b.status', 'completed')->selectRaw('COUNT(*) AS count, COALESCE(AVG(r.rating), 0) AS average')->first();

        return response()->json(['reviews' => $reviews, 'summary' => $summary]);
    }
}
