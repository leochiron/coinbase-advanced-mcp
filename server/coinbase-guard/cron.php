<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/Guard.php';

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo "Missing config.local.php\n";
    exit(1);
}

$config = require $configPath;
if (!is_array($config)) {
    http_response_code(500);
    echo "Invalid config.local.php\n";
    exit(1);
}

$token = PHP_SAPI === 'cli'
    ? (($argv[1] ?? '') === '--token' ? ($argv[2] ?? '') : ($argv[1] ?? ''))
    : (string) ($_GET['token'] ?? '');

if (!hash_equals((string) ($config['cron_token'] ?? ''), $token)) {
    http_response_code(403);
    echo "Forbidden\n";
    exit(1);
}

$guard = new Guard($config);
$result = $guard->run();

header('Content-Type: application/json; charset=utf-8');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
