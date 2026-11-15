<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class PrivateFileService
{
    public function parseProof(?string $dataUrl): ?array
    {
        return $this->parse($dataUrl, ['image/jpeg', 'image/png', 'application/pdf'], 5 * 1024 * 1024);
    }

    public function parseBicyclePhoto(?string $dataUrl): ?array
    {
        return $this->parse($dataUrl, ['image/jpeg', 'image/png', 'image/webp'], 10 * 1024 * 1024);
    }

    public function save(array $file, string $directory): string
    {
        $filename = (string) Str::uuid().'.'.$file['extension'];
        Storage::disk('private_uploads')->put($directory.'/'.$filename, $file['contents']);

        return $filename;
    }

    public function delete(string $directory, string $filename): void
    {
        Storage::disk('private_uploads')->delete($directory.'/'.basename($filename));
    }

    public function path(string $directory, string $filename): string
    {
        return Storage::disk('private_uploads')->path($directory.'/'.basename($filename));
    }

    private function parse(?string $dataUrl, array $allowedTypes, int $maxBytes): ?array
    {
        if (! $dataUrl || ! preg_match('/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+\/=]+)$/', $dataUrl, $matches)) {
            return null;
        }

        $contentType = $matches[1];
        if (! in_array($contentType, $allowedTypes, true)) {
            return null;
        }

        $contents = base64_decode($matches[2], true);
        if ($contents === false || strlen($contents) === 0 || strlen($contents) > $maxBytes) {
            return null;
        }

        $valid = match ($contentType) {
            'image/jpeg' => strlen($contents) >= 3 && substr($contents, 0, 3) === "\xFF\xD8\xFF",
            'image/png' => strlen($contents) >= 8 && substr($contents, 0, 8) === "\x89PNG\r\n\x1A\n",
            'image/webp' => strlen($contents) >= 12 && substr($contents, 0, 4) === 'RIFF' && substr($contents, 8, 4) === 'WEBP',
            'application/pdf' => str_starts_with($contents, '%PDF-'),
            default => false,
        };

        if (! $valid) {
            return null;
        }

        $extension = match ($contentType) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'pdf',
        };

        return compact('contents', 'contentType', 'extension');
    }
}
