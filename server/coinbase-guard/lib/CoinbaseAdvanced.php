<?php

declare(strict_types=1);

final class CoinbaseAdvanced
{
    public function __construct(
        private readonly string $apiKeyName,
        private readonly string $privateKeyPem,
        private readonly string $baseUrl = 'https://api.coinbase.com',
    ) {}

    /** @return array<string,mixed> */
    public function getOrder(string $orderId): array
    {
        $response = $this->request('GET', '/api/v3/brokerage/orders/historical/' . rawurlencode($orderId));
        return isset($response['order']) && is_array($response['order']) ? $response['order'] : $response;
    }

    /** @return array<string,mixed> */
    public function getProduct(string $productId): array
    {
        return $this->request('GET', '/api/v3/brokerage/products/' . rawurlencode($productId), [
            'get_tradability_status' => 'true',
        ]);
    }

    /** @return array<string,mixed> */
    public function cancelOrders(array $orderIds): array
    {
        return $this->request('POST', '/api/v3/brokerage/orders/batch_cancel', [], [
            'order_ids' => array_values($orderIds),
        ]);
    }

    /** @param array<string,mixed> $payload */
    public function createOrder(array $payload): array
    {
        return $this->request('POST', '/api/v3/brokerage/orders', [], $payload);
    }

    /** @return array<string,mixed> */
    private function request(string $method, string $path, array $query = [], ?array $body = null): array
    {
        $url = rtrim($this->baseUrl, '/') . $path;
        if ($query !== []) {
            $url .= '?' . http_build_query($query);
        }

        $headers = [
            'Authorization: Bearer ' . $this->createJwt($method, $path),
            'Accept: application/json',
            'Content-Type: application/json',
        ];

        $payload = $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR);
        $raw = $this->httpRequest($method, $url, $headers, $payload);
        $decoded = json_decode($raw['body'], true);
        $response = is_array($decoded) ? $decoded : ['raw' => $raw['body']];

        if ($raw['status'] < 200 || $raw['status'] >= 300) {
            throw new RuntimeException('Coinbase HTTP ' . $raw['status'] . ': ' . json_encode($response));
        }

        return $response;
    }

    /** @return array{status:int,body:string} */
    private function httpRequest(string $method, string $url, array $headers, ?string $body): array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 30,
            ]);
            if ($body !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            }
            $responseBody = curl_exec($ch);
            if ($responseBody === false) {
                $error = curl_error($ch);
                curl_close($ch);
                throw new RuntimeException('cURL failed: ' . $error);
            }
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            return ['status' => $status, 'body' => (string) $responseBody];
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $body ?? '',
                'timeout' => 30,
                'ignore_errors' => true,
            ],
        ]);
        $responseBody = file_get_contents($url, false, $context);
        if ($responseBody === false) {
            throw new RuntimeException('HTTP request failed');
        }
        $status = 0;
        foreach ($http_response_header ?? [] as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches)) {
                $status = (int) $matches[1];
                break;
            }
        }
        return ['status' => $status, 'body' => $responseBody];
    }

    private function createJwt(string $method, string $path): string
    {
        $host = parse_url($this->baseUrl, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            throw new RuntimeException('Invalid Coinbase API base URL');
        }

        $now = time();
        $header = [
            'alg' => 'ES256',
            'typ' => 'JWT',
            'kid' => $this->apiKeyName,
            'nonce' => bin2hex(random_bytes(16)),
        ];
        $claims = [
            'iss' => 'cdp',
            'sub' => $this->apiKeyName,
            'nbf' => $now,
            'exp' => $now + 120,
            'uri' => strtoupper($method) . ' ' . $host . $path,
        ];

        $signingInput = self::base64Url(json_encode($header, JSON_THROW_ON_ERROR)) . '.'
            . self::base64Url(json_encode($claims, JSON_THROW_ON_ERROR));

        $key = openssl_pkey_get_private($this->normalizePrivateKey($this->privateKeyPem));
        if ($key === false) {
            throw new RuntimeException('Unable to load Coinbase private key');
        }

        $ok = openssl_sign($signingInput, $derSignature, $key, OPENSSL_ALGO_SHA256);
        if (!$ok) {
            throw new RuntimeException('Unable to sign Coinbase JWT');
        }

        return $signingInput . '.' . self::base64Url(self::ecdsaDerToJose($derSignature, 64));
    }

    private function normalizePrivateKey(string $value): string
    {
        return trim(str_replace('\\n', "\n", $value));
    }

    private static function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function ecdsaDerToJose(string $der, int $partLength): string
    {
        $offset = 0;
        if (ord($der[$offset++]) !== 0x30) {
            throw new RuntimeException('Invalid ECDSA signature');
        }
        self::readLength($der, $offset);

        if (ord($der[$offset++]) !== 0x02) {
            throw new RuntimeException('Invalid ECDSA signature R');
        }
        $rLength = self::readLength($der, $offset);
        $r = substr($der, $offset, $rLength);
        $offset += $rLength;

        if (ord($der[$offset++]) !== 0x02) {
            throw new RuntimeException('Invalid ECDSA signature S');
        }
        $sLength = self::readLength($der, $offset);
        $s = substr($der, $offset, $sLength);

        return self::leftPad(self::trimInteger($r), intdiv($partLength, 2))
            . self::leftPad(self::trimInteger($s), intdiv($partLength, 2));
    }

    private static function readLength(string $data, int &$offset): int
    {
        $length = ord($data[$offset++]);
        if ($length < 0x80) {
            return $length;
        }
        $bytes = $length & 0x7f;
        $length = 0;
        for ($i = 0; $i < $bytes; $i++) {
            $length = ($length << 8) | ord($data[$offset++]);
        }
        return $length;
    }

    private static function trimInteger(string $value): string
    {
        return ltrim($value, "\x00");
    }

    private static function leftPad(string $value, int $length): string
    {
        if (strlen($value) > $length) {
            return substr($value, -$length);
        }
        return str_pad($value, $length, "\x00", STR_PAD_LEFT);
    }
}
