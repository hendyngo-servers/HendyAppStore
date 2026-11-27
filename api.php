<?php
declare(strict_types=1);

/* Optional compatibility bridge for conventional PHP hosting only.
 * Cloudflare Pages/Workers do not execute PHP. The canonical API is /api/*
 * on workers/backend-api. This bridge exposes only public read-only routes. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
$base = trim((string) (getenv('HENDY_API_BASE_URL') ?: ''));
if ($base === '') reply(503, ['success' => false, 'error' => 'php_bridge_not_configured']);
$parts = parse_url($base);
if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) ||
    isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
    reply(503, ['success' => false, 'error' => 'invalid_upstream_configuration']);
}
$routes = ['health' => '/api/health', 'apps' => '/api/apps', 'releases' => '/api/releases'];
$route = strtolower(trim((string) ($_GET['route'] ?? 'health')));
if (!array_key_exists($route, $routes)) reply(404, ['success' => false, 'error' => 'route_not_found']);
if (!function_exists('curl_init')) reply(503, ['success' => false, 'error' => 'php_curl_extension_required']);

$body = '';
$handle = curl_init(rtrim($base, '/') . $routes[$route]);
curl_setopt_array($handle, [
    CURLOPT_RETURNTRANSFER => false, CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12,
    CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HTTPGET => true, CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body): int {
        if (strlen($body) + strlen($chunk) > 2097152) return 0;
        $body .= $chunk;
        return strlen($chunk);
    },
]);
if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) curl_setopt($handle, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
$ok = curl_exec($handle);
$status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
$error = curl_error($handle);
curl_close($handle);
if ($ok === false) reply(502, ['success' => false, 'error' => 'upstream_request_failed', 'detail' => substr($error, 0, 160)]);
http_response_code($status > 0 ? $status : 502);
echo $body !== '' ? $body : '{"success":false,"error":"empty_upstream_response"}';
