<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function register(Request $request): JsonResponse
    {
        $fullName = trim((string) $request->input('fullName', ''));
        $email = Str::lower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        if (mb_strlen($fullName) < 2 || mb_strlen($fullName) > 120) {
            return response()->json(['error' => 'Enter your name (2 to 120 characters).'], 400);
        }

        if (mb_strlen($email) > 254 || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['error' => 'Enter a valid email address.'], 400);
        }

        if (mb_strlen($password) < 10 || strlen($password) > 72) {
            return response()->json(['error' => 'Password must be at least 10 characters and no more than 72 UTF-8 bytes.'], 400);
        }

        try {
            $user = User::create([
                'full_name' => $fullName,
                'email' => $email,
                'password_hash' => Hash::make($password),
                'role' => 'customer',
                'is_active' => true,
            ]);
        } catch (QueryException $exception) {
            if (($exception->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'An account with this email already exists.'], 409);
            }

            throw $exception;
        }

        return response()->json(['user' => $this->userPayload($user)], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $email = Str::lower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        if ($email === '' || mb_strlen($email) > 254 || $password === '' || strlen($password) > 72
            || ! Auth::attempt(['email' => $email, 'password' => $password, 'is_active' => 1])) {
            return response()->json(['error' => 'Email or password is incorrect.'], 401);
        }

        $request->session()->regenerate();

        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([], 204);
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $email = Str::lower(trim((string) $request->input('email', '')));

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['error' => 'Enter a valid email address.'], 400);
        }

        $user = User::query()->where('email', $email)->where('is_active', true)->first();
        $result = ['message' => 'If an active account uses that email, a password reset link has been created.'];

        if ($user) {
            $token = bin2hex(random_bytes(32));
            DB::table('password_reset_tokens')->where('user_id', $user->id)->delete();
            DB::table('password_reset_tokens')->insert([
                'user_id' => $user->id,
                'token_hash' => hash('sha256', $token),
                'expires_at' => now('UTC')->addMinutes(30)->format('Y-m-d H:i:s'),
                'created_at' => now('UTC')->format('Y-m-d H:i:s'),
            ]);

            if (app()->environment('local', 'development')) {
                $origin = rtrim((string) env('FRONTEND_ORIGIN', 'http://localhost:5173'), '/');
                $result['resetUrl'] = $origin.'/reset-password?token='.$token;
            } else {
                logger()->warning('Password reset requested but no mail delivery integration is configured.');
            }
        }

        return response()->json($result);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $token = (string) $request->input('token', '');
        $password = (string) $request->input('password', '');

        if (! preg_match('/^[a-f0-9]{64}$/', $token)) {
            return response()->json(['error' => 'Reset link is invalid or expired.'], 400);
        }

        if (mb_strlen($password) < 10 || strlen($password) > 72) {
            return response()->json(['error' => 'Password must be at least 10 characters and no more than 72 UTF-8 bytes.'], 400);
        }

        $userId = DB::transaction(function () use ($token, $password): ?int {
            $reset = DB::table('password_reset_tokens')
                ->where('token_hash', hash('sha256', $token))
                ->whereNull('used_at')
                ->where('expires_at', '>', now('UTC')->format('Y-m-d H:i:s'))
                ->lockForUpdate()
                ->first();

            if (! $reset) {
                return null;
            }

            DB::table('users')->where('id', $reset->user_id)->update(['password_hash' => Hash::make($password)]);
            DB::table('password_reset_tokens')
                ->where('user_id', $reset->user_id)
                ->whereNull('used_at')
                ->update(['used_at' => now('UTC')->format('Y-m-d H:i:s')]);

            return (int) $reset->user_id;
        });

        if (! $userId) {
            return response()->json(['error' => 'Reset link is invalid or expired. Request a new one.'], 400);
        }

        return response()->json(['message' => 'Your password has been updated. Please sign in again.']);
    }

    private function userPayload(?User $user): array
    {
        return [
            'id' => $user?->id,
            'fullName' => $user?->full_name,
            'email' => $user?->email,
            'role' => $user?->role,
        ];
    }
}
