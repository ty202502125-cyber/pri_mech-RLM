<?php

use App\Http\Controllers\Api\AdminContentController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/uploads/{path}', [AdminContentController::class, 'publicFile'])->where('path', '.*');
