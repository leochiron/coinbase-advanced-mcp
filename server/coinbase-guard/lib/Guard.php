<?php

declare(strict_types=1);

require_once __DIR__ . '/CoinbaseAdvanced.php';

final class Guard
{
    private string $stateDir;
    private string $auditLog;
    private string $statusFile;
    private string $protectionStateFile;
    private CoinbaseAdvanced $client;

    /** @param array<string,mixed> $config */
    public function __construct(private readonly array $config)
    {
        $this->stateDir = (string) ($config['state_dir'] ?? (__DIR__ . '/../state'));
        if (!is_dir($this->stateDir)) {
            mkdir($this->stateDir, 0700, true);
        }
        $this->auditLog = $this->stateDir . '/audit.log';
        $this->statusFile = $this->stateDir . '/status.json';
        $this->protectionStateFile = $this->stateDir . '/protection-state.json';
        $this->client = new CoinbaseAdvanced(
            (string) $config['coinbase_api_key_name'],
            (string) $config['coinbase_api_private_key'],
            (string) ($config['coinbase_api_base_url'] ?? 'https://api.coinbase.com'),
        );
    }

    /** @return array<string,mixed> */
    public function run(): array
    {
        $startedAt = date(DATE_ATOM);
        $events = [];

        if (($this->config['enabled'] ?? false) !== true) {
            $result = ['startedAt' => $startedAt, 'enabled' => false, 'events' => []];
            $this->writeStatus($result);
            return $result;
        }

        foreach (($this->config['managed_orders'] ?? []) as $managedOrder) {
            if (!is_array($managedOrder)) {
                continue;
            }
            $events[] = $this->checkManagedOrder($managedOrder);
        }

        $protectionEvents = [];
        foreach (($this->config['protection_orders'] ?? []) as $protectionOrder) {
            if (!is_array($protectionOrder)) {
                continue;
            }
            $protectionEvents[] = $this->checkProtectionOrder($protectionOrder);
        }

        $result = [
            'startedAt' => $startedAt,
            'finishedAt' => date(DATE_ATOM),
            'enabled' => true,
            'liveCancelEnabled' => $this->liveCancelEnabled(),
            'liveProtectionEnabled' => $this->liveProtectionEnabled(),
            'events' => $events,
            'protectionEvents' => $protectionEvents,
        ];
        $this->writeStatus($result);
        return $result;
    }

    /** @param array<string,mixed> $managedOrder */
    private function checkManagedOrder(array $managedOrder): array
    {
        $orderId = (string) ($managedOrder['order_id'] ?? '');
        $productId = (string) ($managedOrder['product_id'] ?? '');
        $label = (string) ($managedOrder['label'] ?? $productId);

        if ($orderId === '' || $productId === '') {
            return ['label' => $label, 'status' => 'CONFIG_ERROR', 'message' => 'order_id and product_id are required'];
        }

        try {
            $coinbaseOrder = $this->client->getOrder($orderId);
            $status = (string) ($coinbaseOrder['status'] ?? 'UNKNOWN');
            $filledSize = (string) ($coinbaseOrder['filled_size'] ?? '0');

            $event = [
                'label' => $label,
                'orderId' => $orderId,
                'productId' => $productId,
                'orderStatus' => $status,
                'filledSize' => $filledSize,
                'checkedAt' => date(DATE_ATOM),
            ];

            if (!in_array($status, ['OPEN', 'PENDING', 'QUEUED', 'CANCEL_QUEUED'], true)) {
                $event['status'] = 'NO_ACTION';
                $event['reason'] = 'order_not_open';
                return $event;
            }

            $price = $this->currentPrice($productId);
            $event['currentPrice'] = $price;
            $cancelReason = $this->cancelReason($managedOrder, $price);

            if ($cancelReason === null) {
                $event['status'] = 'NO_ACTION';
                $event['reason'] = 'rules_not_triggered';
                return $event;
            }

            $event['cancelReason'] = $cancelReason;
            if (!$this->liveCancelEnabled()) {
                $event['status'] = 'WOULD_CANCEL';
                $this->audit('would_cancel', $event);
                return $event;
            }

            $response = $this->client->cancelOrders([$orderId]);
            $event['status'] = 'CANCEL_REQUESTED';
            $event['coinbaseResponse'] = $response;
            $this->audit('cancel_requested', $event);
            $this->sendMail('Coinbase guard cancelled ' . $productId, $this->formatMailBody($event));
            return $event;
        } catch (Throwable $error) {
            $event = [
                'label' => $label,
                'orderId' => $orderId,
                'productId' => $productId,
                'status' => 'ERROR',
                'message' => $error->getMessage(),
                'checkedAt' => date(DATE_ATOM),
            ];
            $this->audit('error', $event);
            return $event;
        }
    }

    /** @param array<string,mixed> $managedOrder */
    private function cancelReason(array $managedOrder, float $price): ?string
    {
        $cancelAfter = $managedOrder['cancel_after'] ?? null;
        if (is_string($cancelAfter) && $cancelAfter !== '') {
            $deadline = strtotime($cancelAfter);
            if ($deadline !== false && time() >= $deadline) {
                return 'cancel_after reached: ' . $cancelAfter;
            }
        }

        $below = $managedOrder['cancel_if_price_below'] ?? null;
        if ($below !== null && $below !== '' && $price <= (float) $below) {
            return 'current price ' . $price . ' <= cancel_if_price_below ' . $below;
        }

        $above = $managedOrder['cancel_if_price_above'] ?? null;
        if ($above !== null && $above !== '' && $price >= (float) $above) {
            return 'current price ' . $price . ' >= cancel_if_price_above ' . $above;
        }

        return null;
    }

    private function currentPrice(string $productId): float
    {
        $product = $this->client->getProduct($productId);
        if (!isset($product['price'])) {
            throw new RuntimeException('No price returned for ' . $productId);
        }
        return (float) $product['price'];
    }

    /** @param array<string,mixed> $protectionOrder */
    private function checkProtectionOrder(array $protectionOrder): array
    {
        $parentOrderId = (string) ($protectionOrder['parent_order_id'] ?? '');
        $productId = (string) ($protectionOrder['product_id'] ?? '');
        $label = (string) ($protectionOrder['label'] ?? $productId);

        if (($protectionOrder['active'] ?? true) !== true) {
            return ['label' => $label, 'status' => 'NO_ACTION', 'reason' => 'inactive'];
        }

        if ($parentOrderId === '' || $productId === '') {
            return ['label' => $label, 'status' => 'CONFIG_ERROR', 'message' => 'parent_order_id and product_id are required'];
        }

        try {
            $parent = $this->client->getOrder($parentOrderId);
            $parentStatus = (string) ($parent['status'] ?? 'UNKNOWN');
            $filledSize = (string) ($parent['filled_size'] ?? '0');
            $filled = (float) $filledSize;
            $state = $this->readProtectionState();
            $stored = is_array($state[$parentOrderId] ?? null) ? $state[$parentOrderId] : [];
            $protectedSize = (float) ($stored['protected_size'] ?? '0');
            $baseIncrement = (string) ($protectionOrder['base_increment'] ?? '0.00000001');
            $delta = $this->formatBaseSize($filled - $protectedSize, $baseIncrement);

            $event = [
                'label' => $label,
                'parentOrderId' => $parentOrderId,
                'productId' => $productId,
                'parentStatus' => $parentStatus,
                'filledSize' => $filledSize,
                'protectedSize' => (string) ($stored['protected_size'] ?? '0'),
                'deltaToProtect' => $delta,
                'checkedAt' => date(DATE_ATOM),
            ];

            $attachedOrderId = (string) ($parent['attached_order_id'] ?? '');
            if (($protectionOrder['skip_when_parent_has_attached_order'] ?? true) === true && $this->hasAttachedProtection($parent)) {
                $event['status'] = 'NO_ACTION';
                $event['reason'] = 'coinbase_attached_order_present';
                $event['attachedOrderId'] = $attachedOrderId;
                return $event;
            }

            if ($filled <= 0.0 || (float) $delta <= 0.0) {
                $event['status'] = 'NO_ACTION';
                $event['reason'] = 'nothing_new_to_protect';
                return $event;
            }

            if (!in_array($parentStatus, ['FILLED', 'DONE', 'SETTLED'], true) && ($protectionOrder['protect_partial_fills'] ?? false) !== true) {
                $event['status'] = 'NO_ACTION';
                $event['reason'] = 'parent_not_terminal';
                return $event;
            }

            $payload = $this->buildProtectionPayload($protectionOrder, $productId, $delta);
            $event['payloadPreview'] = $payload;

            if (!$this->liveProtectionEnabled()) {
                $event['status'] = 'WOULD_PROTECT';
                $this->audit('would_protect', $event);
                return $event;
            }

            $response = $this->client->createOrder($payload);
            $coinbaseOrderId = $this->extractCreatedOrderId($response);
            if ($coinbaseOrderId === null) {
                $event['status'] = 'PROTECTION_FAILED';
                $event['coinbaseResponse'] = $response;
                $this->audit('protection_failed', $event);
                return $event;
            }

            $newProtectedSize = $this->formatBaseSize($protectedSize + (float) $delta, $baseIncrement);
            $stored['protected_size'] = $newProtectedSize;
            $stored['updated_at'] = date(DATE_ATOM);
            $stored['protection_orders'][] = [
                'coinbase_order_id' => $coinbaseOrderId,
                'client_order_id' => $payload['client_order_id'],
                'base_size' => $delta,
                'created_at' => date(DATE_ATOM),
            ];
            $state[$parentOrderId] = $stored;
            $this->writeProtectionState($state);

            $event['status'] = 'PROTECTION_SUBMITTED';
            $event['coinbaseOrderId'] = $coinbaseOrderId;
            $event['protectedSize'] = $newProtectedSize;
            $this->audit('protection_submitted', $event);
            $this->sendMail('Coinbase protection submitted ' . $productId, $this->formatMailBody($event));
            return $event;
        } catch (Throwable $error) {
            $event = [
                'label' => $label,
                'parentOrderId' => $parentOrderId,
                'productId' => $productId,
                'status' => 'ERROR',
                'message' => $error->getMessage(),
                'checkedAt' => date(DATE_ATOM),
            ];
            $this->audit('error', $event);
            return $event;
        }
    }

    private function liveCancelEnabled(): bool
    {
        return ($this->config['live_cancel_enabled'] ?? false) === true
            && ($this->config['cancel_confirmation_text'] ?? '') === 'CONFIRM_CANCEL_ORDER';
    }

    private function liveProtectionEnabled(): bool
    {
        return ($this->config['live_protection_enabled'] ?? false) === true
            && ($this->config['protection_confirmation_text'] ?? '') === 'CONFIRM_EXECUTE_ORDER';
    }

    /** @param array<string,mixed> $protectionOrder */
    private function buildProtectionPayload(array $protectionOrder, string $productId, string $baseSize): array
    {
        return [
            'client_order_id' => 'php-guard-' . bin2hex(random_bytes(16)),
            'product_id' => $productId,
            'side' => 'SELL',
            'order_configuration' => [
                'trigger_bracket_gtc' => [
                    'base_size' => $baseSize,
                    'limit_price' => (string) $protectionOrder['take_profit_price'],
                    'stop_trigger_price' => (string) $protectionOrder['stop_loss_price'],
                ],
            ],
        ];
    }

    private function formatBaseSize(float $value, string $increment): string
    {
        $incrementFloat = (float) $increment;
        if ($value <= 0.0 || $incrementFloat <= 0.0) {
            return '0';
        }

        $steps = floor(($value + ($incrementFloat / 1000)) / $incrementFloat);
        $rounded = $steps * $incrementFloat;
        $decimals = $this->decimalPlaces($increment);
        return rtrim(rtrim(number_format($rounded, $decimals, '.', ''), '0'), '.') ?: '0';
    }

    private function decimalPlaces(string $value): int
    {
        $position = strpos($value, '.');
        return $position === false ? 0 : strlen(rtrim(substr($value, $position + 1), '0'));
    }

    private function extractCreatedOrderId(array $response): ?string
    {
        if (isset($response['order_id']) && is_string($response['order_id'])) {
            return $response['order_id'];
        }

        if (isset($response['success_response']) && is_array($response['success_response'])) {
            $orderId = $response['success_response']['order_id'] ?? null;
            return is_string($orderId) && $orderId !== '' ? $orderId : null;
        }

        return null;
    }

    /** @param array<string,mixed> $order */
    private function hasAttachedProtection(array $order): bool
    {
        if (isset($order['attached_order_id']) && (string) $order['attached_order_id'] !== '') {
            return true;
        }

        if (isset($order['attached_order_configuration']) && is_array($order['attached_order_configuration'])) {
            return true;
        }

        foreach (($order['order_configuration'] ?? []) as $configuration) {
            if (is_array($configuration) && isset($configuration['attached_order_configuration'])) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string,mixed> */
    private function readProtectionState(): array
    {
        if (!is_file($this->protectionStateFile)) {
            return [];
        }

        $raw = file_get_contents($this->protectionStateFile);
        if ($raw === false || $raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /** @param array<string,mixed> $state */
    private function writeProtectionState(array $state): void
    {
        file_put_contents($this->protectionStateFile, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL, LOCK_EX);
    }

    /** @param array<string,mixed> $payload */
    private function audit(string $type, array $payload): void
    {
        file_put_contents($this->auditLog, json_encode([
            'time' => date(DATE_ATOM),
            'type' => $type,
            'payload' => $payload,
        ], JSON_UNESCAPED_SLASHES) . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    /** @param array<string,mixed> $status */
    private function writeStatus(array $status): void
    {
        file_put_contents($this->statusFile, json_encode($status, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL, LOCK_EX);
    }

    private function sendMail(string $subject, string $body): void
    {
        $to = (string) ($this->config['mail_to'] ?? '');
        if ($to === '') {
            return;
        }
        $from = (string) ($this->config['mail_from'] ?? 'coinbase-guard@localhost');
        $headers = "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8\r\n";
        if (!mail($to, $subject, $body, $headers)) {
            $this->audit('mail_failed', ['to' => $to, 'subject' => $subject]);
        }
    }

    /** @param array<string,mixed> $event */
    private function formatMailBody(array $event): string
    {
        return "Coinbase guard event\n\n" . json_encode($event, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    }
}
