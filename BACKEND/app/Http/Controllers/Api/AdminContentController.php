<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AdminContentController extends Controller
{
    public function saveMechanicProfile(Request $request): JsonResponse
    {
        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:120'],
            'role' => ['required', 'string', 'max:160'],
            'bio' => ['required', 'string', 'min:20', 'max:5000'],
            'highlights' => ['required', 'array', 'max:12'],
            'highlights.*.icon' => ['nullable', 'string', 'max:80'],
            'highlights.*.iconImage' => ['nullable', 'string'],
            'highlights.*.val' => ['required', 'string', 'max:80'],
            'highlights.*.sub' => ['required', 'string', 'max:160'],
            'expertise' => ['required', 'array', 'max:24'],
            'expertise.*.area' => ['required', 'string', 'max:120'],
            'expertise.*.detail' => ['required', 'string', 'max:500'],
            'expertise.*.image' => ['nullable', 'string'],
            'licences' => ['required', 'array', 'max:24'],
            'licences.*.title' => ['required', 'string', 'max:250'],
            'licences.*.image' => ['nullable', 'string'],
            'agreements' => ['required', 'array', 'max:24'],
            'agreements.*.title' => ['required', 'string', 'max:250'],
            'agreements.*.image' => ['nullable', 'string'],
        ]);

        foreach ($data['highlights'] as &$highlight) {
            if (! empty($highlight['iconImage'])) {
                $highlight['iconImage'] = $this->storeProfileImage($highlight['iconImage']);
            }
        }
        unset($highlight);

        foreach ($data['expertise'] as &$expertise) {
            if (! empty($expertise['image'])) {
                $expertise['image'] = $this->storeProfileImage($expertise['image']);
            }
        }
        unset($expertise);

        foreach (['licences', 'agreements'] as $collection) {
            foreach ($data[$collection] as &$item) {
                if (! empty($item['image'])) {
                    $item['image'] = $this->storeProfileImage($item['image']);
                }
            }
            unset($item);
        }

        DB::table('mechanic_profile')->where('id', 1)->update([
            'full_name' => $data['full_name'],
            'role' => $data['role'],
            'bio' => $data['bio'],
            'highlights' => json_encode($data['highlights'], JSON_THROW_ON_ERROR),
            'expertise' => json_encode($data['expertise'], JSON_THROW_ON_ERROR),
            'licences' => json_encode($data['licences'], JSON_THROW_ON_ERROR),
            'agreements' => json_encode($data['agreements'], JSON_THROW_ON_ERROR),
            'updated_at' => now('UTC'),
        ]);

        return response()->json([
            'profile' => DB::table('mechanic_profile')->where('id', 1)->first(),
            'message' => 'Public mechanic profile saved.',
        ]);
    }

    private function storeProfileImage(string $imageData): string
    {
        if (! preg_match('/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+\/=]+)$/', $imageData, $match)) {
            abort(response()->json(['error' => 'Choose a valid JPEG, PNG, or WebP profile image.'], 400));
        }

        $bytes = base64_decode($match[2], true);
        $signatures = ['jpeg' => "\xFF\xD8\xFF", 'png' => "\x89PNG\r\n\x1A\n", 'webp' => 'RIFF'];
        if ($bytes === false || strlen($bytes) < 12 || strlen($bytes) > 5 * 1024 * 1024 || ! str_starts_with($bytes, $signatures[$match[1]])) {
            abort(response()->json(['error' => 'Profile images must be valid and no larger than 5 MB.'], 400));
        }

        $extension = $match[1] === 'jpeg' ? 'jpg' : $match[1];
        $path = 'profile/mechanic/'.Str::uuid().'.'.$extension;
        Storage::disk('legacy_uploads')->put($path, $bytes);

        return '/uploads/'.$path;
    }

    public function builds(): JsonResponse
    {
        return response()->json(['builds' => DB::table('mechanic_builds')->orderByDesc('created_at')->get()]);
    }

    public function certifications(): JsonResponse
    {
        return response()->json(['certifications' => DB::table('mechanic_certifications')->orderByDesc('created_at')->get()]);
    }

    public function createBuild(Request $request): JsonResponse
    {
        return $this->save($request, 'builds');
    }

    public function updateBuild(Request $request, int $id): JsonResponse
    {
        return $this->save($request, 'builds', $id);
    }

    public function deleteBuild(int $id): JsonResponse
    {
        return $this->delete('builds', $id);
    }

    public function createCertification(Request $request): JsonResponse
    {
        return $this->save($request, 'certifications');
    }

    public function updateCertification(Request $request, int $id): JsonResponse
    {
        return $this->save($request, 'certifications', $id);
    }

    public function deleteCertification(int $id): JsonResponse
    {
        return $this->delete('certifications', $id);
    }

    public function save(Request $request, string $kind, ?int $id = null): JsonResponse
    {
        $creating = $id === null;
        $isBuild = $kind === 'builds';
        $data = $request->validate($isBuild ? [
            'title' => ['required', 'string', 'min:2', 'max:140'], 'ownerName' => ['required', 'string', 'min:2', 'max:120'], 'socialUrl' => ['nullable', 'url', 'regex:/^https:\/\//i', 'max:500'], 'imageData' => [$id ? 'sometimes' : 'required', 'string'],
        ] : [
            'body' => ['required', 'string', 'min:2', 'max:80'], 'title' => ['required', 'string', 'min:2', 'max:180'], 'year' => ['required', 'string', 'min:2', 'max:20'], 'imageData' => [$id ? 'sometimes' : 'required', 'string'],
        ]);
        $table = $isBuild ? 'mechanic_builds' : 'mechanic_certifications';
        $columns = $isBuild ? ['title' => $data['title'], 'owner_name' => $data['ownerName'], 'social_url' => $data['socialUrl'] ?? null] : ['body' => $data['body'], 'title' => $data['title'], 'year' => $data['year']];
        if (isset($data['imageData'])) {
            if (! preg_match('/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+\/=]+)$/', $data['imageData'], $match)) {
                return response()->json(['error' => 'Choose a valid JPEG, PNG, or WebP image.'], 400);
            }
            $bytes = base64_decode($match[2], true);
            if ($bytes === false || strlen($bytes) < 12 || strlen($bytes) > 5 * 1024 * 1024) {
                return response()->json(['error' => 'Image must be smaller than 5 MB.'], 400);
            }
            $mime = ['jpeg' => "\xFF\xD8\xFF", 'png' => "\x89PNG\r\n\x1A\n", 'webp' => 'RIFF'];
            if (! str_starts_with($bytes, $mime[$match[1]])) {
                return response()->json(['error' => 'Image content does not match its file type.'], 400);
            }
            $ext = $match[1] === 'jpeg' ? 'jpg' : $match[1];
            $name = 'profile/'.$kind.'/'.Str::uuid().'.'.$ext;
            Storage::disk('legacy_uploads')->put($name, $bytes);
            $columns['image_url'] = '/uploads/'.$name;
        }
        if ($id) {
            $previousImage = DB::table($table)->where('id', $id)->value('image_url');
            $updated = DB::table($table)->where('id', $id)->update($columns);
            if (! $updated && ! DB::table($table)->where('id', $id)->exists()) {
                return response()->json(['error' => 'Content item not found.'], 404);
            }
            if (isset($columns['image_url']) && $previousImage && $previousImage !== $columns['image_url']) {
                $this->deletePublicUrl((string) $previousImage);
            }
        } else {
            $columns['created_at'] = now('UTC');
            $id = DB::table($table)->insertGetId($columns);
        }

        return response()->json(['id' => $id, 'message' => 'Content saved.'], $creating ? 201 : 200);
    }

    public function delete(string $kind, int $id): JsonResponse
    {
        $table = $kind === 'builds' ? 'mechanic_builds' : 'mechanic_certifications';
        $imageUrl = DB::table($table)->where('id', $id)->value('image_url');
        $deleted = DB::table($table)->where('id', $id)->delete();
        if ($deleted && $imageUrl) {
            $this->deletePublicUrl((string) $imageUrl);
        }

        return $deleted ? response()->json(['message' => 'Content removed.']) : response()->json(['error' => 'Content item not found.'], 404);
    }

    private function deletePublicUrl(string $url): void
    {
        if (! str_starts_with($url, '/uploads/')) {
            return;
        }
        $path = substr($url, strlen('/uploads/'));
        if ($path !== '' && ! str_contains($path, '..')) {
            Storage::disk('legacy_uploads')->delete($path);
        }
    }

    public function publicFile(string $path)
    {
        $path = ltrim(str_replace('\\', '/', $path), '/');
        if ($path === '' || str_contains($path, '..') || str_starts_with($path, '.')) {
            abort(404);
        }
        $disk = Storage::disk('legacy_uploads');
        if (! $disk->exists($path)) {
            abort(404);
        }

        return response()->file($disk->path($path), ['Cache-Control' => 'public, max-age=86400', 'X-Content-Type-Options' => 'nosniff']);
    }
}
