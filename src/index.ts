import { CoinbaseClient } from "./coinbase/coinbaseClient.js";
import { loadEnv } from "./config/env.js";
import { createMcpServer } from "./server/mcpServer.js";
import { startHttpTransport } from "./server/httpTransport.js";
import { startStdioTransport } from "./server/stdioTransport.js";
import { AllocationService } from "./services/allocationService.js";
import { AuditService } from "./services/auditService.js";
import { OrderExecutionService } from "./services/orderExecutionService.js";
import { OrderProposalService } from "./services/orderProposalService.js";
import { PaperBrokerService } from "./services/paperBrokerService.js";
import { PortfolioService } from "./services/portfolioService.js";
import { PricingService } from "./services/pricingService.js";
import { RiskLimitService } from "./services/riskLimitService.js";
import { createAuditDatabase } from "./storage/database.js";
import { createLogger } from "./utils/logger.js";
import { redactError } from "./utils/redactSecrets.js";

async function main(): Promise<void> {
    const env = loadEnv();
    const logger = createLogger(env);
    const database = createAuditDatabase(env.auditDatabasePath);
    const auditService = new AuditService(database);
    const coinbaseClient = new CoinbaseClient(env);
    const pricingService = new PricingService(coinbaseClient);
    const portfolioService = new PortfolioService(coinbaseClient, pricingService);
    const allocationService = new AllocationService(portfolioService);
    const orderProposalService = new OrderProposalService(auditService);
    const riskLimitService = new RiskLimitService(auditService, env);
    const paperBrokerService = new PaperBrokerService(database, auditService, pricingService, portfolioService, env);
    const orderExecutionService = new OrderExecutionService(coinbaseClient, auditService, env, riskLimitService, paperBrokerService);

    const server = createMcpServer({
        env,
        auditService,
        portfolioService,
        pricingService,
        allocationService,
        orderProposalService,
        orderExecutionService,
        paperBrokerService
    });

    process.on("SIGINT", () => {
        void server.close();
        database.close();
        process.exit(0);
    });

    if (env.mcpTransport === "stdio") {
        logger.info("Starting Coinbase MCP server over stdio");
        await startStdioTransport(server);
        return;
    }

    await startHttpTransport(server);
}

main().catch((error: unknown) => {
    console.error(redactError(error));
    process.exit(1);
});
