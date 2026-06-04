export type HttpMethod = "GET" | "POST";

export type CoinbaseMoney = {
    value: string;
    currency: string;
};

export type CoinbaseAccount = {
    uuid: string;
    name?: string;
    currency: string;
    available_balance?: CoinbaseMoney;
    hold?: CoinbaseMoney;
    active?: boolean;
    ready?: boolean;
};

export type CoinbaseAccountsResponse = {
    accounts: CoinbaseAccount[];
    has_next?: boolean;
    cursor?: string;
    size?: number;
};

export type CoinbaseProduct = {
    product_id: string;
    base_currency_id?: string;
    quote_currency_id?: string;
    base_increment?: string;
    quote_increment?: string;
    price_increment?: string;
    status?: string;
    trading_disabled?: boolean;
    is_disabled?: boolean;
    product_type?: string;
    price?: string;
};

export type CoinbaseProductsResponse = {
    products: CoinbaseProduct[];
    num_products?: number;
};

export type CoinbaseTickerResponse = {
    trades?: Array<{
        trade_id?: string;
        product_id?: string;
        price?: string;
        size?: string;
        time?: string;
        side?: string;
        exchange?: string;
    }>;
    best_bid?: string;
    best_ask?: string;
};

export type CoinbaseOrderPayload = {
    client_order_id: string;
    product_id: string;
    side: "BUY" | "SELL";
    order_configuration: Record<string, Record<string, string | boolean>>;
    attached_order_configuration?: {
        trigger_bracket_gtc: {
            limit_price: string;
            stop_trigger_price: string;
        };
    };
};

export type CoinbaseCreateOrderResponse = {
    success?: boolean;
    success_response?: {
        order_id?: string;
        product_id?: string;
        side?: string;
        client_order_id?: string;
    };
    order_id?: string;
    error_response?: unknown;
};

export type CoinbaseOrder = {
    order_id?: string;
    product_id?: string;
    side?: string;
    order_type?: string;
    status?: string;
    created_time?: string;
    filled_size?: string;
    completion_percentage?: string;
    outstanding_hold_amount?: string;
    order_configuration?: unknown;
};

export type CoinbaseOrdersResponse = {
    orders: CoinbaseOrder[];
    has_next?: boolean;
    cursor?: string;
};

export type CoinbaseCancelOrdersResponse = {
    results: Array<{
        success?: boolean;
        failure_reason?: string;
        order_id?: string;
    }>;
};

export type CoinbasePortfolio = {
    name?: string;
    uuid?: string;
    portfolio_uuid?: string;
    type?: string;
    deleted?: boolean;
};

export type CoinbasePortfoliosResponse = {
    portfolios: CoinbasePortfolio[];
};

export type CoinbasePortfolioBreakdownResponse = {
    breakdown?: {
        portfolio?: CoinbasePortfolio;
        portfolio_balances?: {
            total_balance?: CoinbaseMoney;
            total_crypto_balance?: CoinbaseMoney;
            total_cash_equivalent_balance?: CoinbaseMoney;
        };
        spot_positions?: Array<{
            asset?: string;
            total_balance_fiat?: number | CoinbaseMoney;
            total_balance_crypto?: number;
            available_to_trade_fiat?: number | CoinbaseMoney;
            allocation?: number;
            account_type?: string;
        }>;
    };
};
