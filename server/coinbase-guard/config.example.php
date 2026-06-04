<?php

declare(strict_types=1);

return [
    'enabled' => true,

    // Live cancellation stays disabled unless both values below are set.
    'live_cancel_enabled' => false,
    'cancel_confirmation_text' => '',

    // Live protection creates sell bracket orders after explicitly listed buy orders fill.
    'live_protection_enabled' => false,
    'protection_confirmation_text' => '',

    'coinbase_api_key_name' => 'organizations/your-org-id/apiKeys/your-key-id',
    'coinbase_api_private_key' => "-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n",
    'coinbase_api_base_url' => 'https://api.coinbase.com',

    'mail_to' => 'alerts@example.com',
    'mail_from' => 'coinbase-guard@your-domain.example.com',

    // Use a long random value. Required for cron.php and status.php over HTTP.
    'cron_token' => 'CHANGE_ME_LONG_RANDOM_TOKEN',
    'status_token' => 'CHANGE_ME_LONG_RANDOM_TOKEN',

    'state_dir' => __DIR__ . '/state',

    /*
     * Only explicitly listed order ids are managed.
     * Cancellation rules are optional and evaluated only while status is OPEN/PENDING/QUEUED.
     */
    'managed_orders' => [
        /*
        [
            'label' => 'BTC breakout buy',
            'order_id' => 'coinbase-order-id',
            'product_id' => 'BTC-EUR',
            'side' => 'BUY',

            // Cancel if still open after this absolute time.
            'cancel_after' => '2026-05-28T22:00:00+02:00',

            // Cancel if the setup is invalidated.
            'cancel_if_price_below' => '62000',

            // Optional: cancel if price ran too far without filling.
            'cancel_if_price_above' => null,
        ],
        */
    ],

    /*
     * Backup protection for parent buy orders.
     * If Coinbase already reports an attached order id, the guard does not duplicate it.
     * Live submission requires live_protection_enabled=true and CONFIRM_EXECUTE_ORDER.
     */
    'protection_orders' => [
        /*
        [
            'active' => true,
            'label' => 'BTC dip buy backup protection',
            'parent_order_id' => 'coinbase-buy-order-id',
            'product_id' => 'BTC-EUR',
            'take_profit_price' => '64500',
            'stop_loss_price' => '61200',
            'base_increment' => '0.00000001',
            'protect_partial_fills' => false,
            'skip_when_parent_has_attached_order' => true,
        ],
        */
    ],
];
