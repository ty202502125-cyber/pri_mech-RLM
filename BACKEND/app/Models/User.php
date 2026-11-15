<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    protected $table = 'users';

    protected $fillable = ['full_name', 'email', 'password_hash', 'role', 'is_active'];

    protected $hidden = ['password_hash', 'remember_token'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    public function getAuthPasswordName(): string
    {
        return 'password_hash';
    }

    public function getAuthPassword(): string
    {
        $hash = (string) $this->getAttribute($this->getAuthPasswordName());

        // bcryptjs writes $2a$ hashes; PHP recognizes the equivalent $2y$ prefix.
        return str_starts_with($hash, '$2a$') ? '$2y$'.substr($hash, 4) : $hash;
    }
}
