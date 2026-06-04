<?php

declare(strict_types=1);

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo "Missing config.local.php\n";
    exit;
}

$config = require $configPath;
$token = (string) ($_GET['token'] ?? '');
if (!hash_equals((string) ($config['status_token'] ?? ''), $token)) {
    http_response_code(403);
    echo "Forbidden\n";
    exit;
}

$statusFile = (string) ($config['state_dir'] ?? (__DIR__ . '/state')) . '/status.json';
$status = is_file($statusFile) ? file_get_contents($statusFile) : '{}';

header('Content-Type: application/json; charset=utf-8');
echo $status === false ? "{}\n" : $status;
