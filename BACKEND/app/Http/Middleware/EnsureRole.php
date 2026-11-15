<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    public function handle(Request $request, Closure $next, string $role): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['error' => 'Please sign in to continue.'], 401);
        }

        if ($user->role !== $role) {
            return response()->json(['error' => 'Mechanic administrator access is required.'], 403);
        }

        return $next($request);
    }
}
