import { loadEnv } from "../config/env.js";
import { AuditService } from "../services/auditService.js";
import { OrderProposalService } from "../services/orderProposalService.js";
import { PaperBrokerService } from "../services/paperBrokerService.js";
import { createAuditDatabase } from "../storage/database.js";
import { redactError } from "../utils/redactSecrets.js";
import { PaperReportService } from "./paperReportService.js";
import { ResearchAutomationService } from "./researchAutomationService.js";
import { ResearchCircuitBreaker } from "./researchCircuitBreaker.js";
import { ResearchPipelineRunner } from "./researchPipelineRunner.js";
import { ResearchProposalBridge } from "./researchProposalBridge.js";
import { ResearchScheduler } from "./researchScheduler.js";

async function main(): Promise<void> {
    const env = loadEnv();
    const database = createAuditDatabase(env.auditDatabasePath);
    const auditService = new AuditService(database);
    const pricingService = {
        getProductTicker: (productId: string) =>
            Promise.reject(new Error(`No fresh artifact price is available for ${productId}`)),
        getPrice: (asset: string, quoteCurrency: string) =>
            Promise.resolve({
                asset,
                quoteCurrency,
                price: asset === quoteCurrency ? 1 : undefined,
                valuationStatus: asset === quoteCurrency ? ("QUOTE_CURRENCY" as const) : ("UNVALUED" as const)
            })
    };
    const portfolioService = {
        getSnapshot: () =>
            Promise.resolve({
                assets: [],
                totalEstimatedValue: 0,
                quoteCurrency: env.defaultQuoteCurrency,
                unvaluedAssets: []
            })
    };
    const proposalService = new OrderProposalService(auditService);
    const paperBroker = new PaperBrokerService(database, auditService, pricingService, portfolioService, {
        ...env,
        coinbaseConfigured: false
    });
    const bridge = new ResearchProposalBridge(auditService, proposalService, env.researchDecisionMaxAgeMinutes);
    const circuitBreaker = new ResearchCircuitBreaker(auditService, env);
    const reportService = new PaperReportService(`${env.projectRoot}/reports`);
    const automation = new ResearchAutomationService(
        env,
        auditService,
        bridge,
        paperBroker,
        circuitBreaker,
        reportService
    );
    const pipeline = new ResearchPipelineRunner(env);
    const scheduler = new ResearchScheduler(env, auditService, automation, pipeline);

    const shutdown = () => scheduler.stop();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    try {
        if (process.argv.includes("--once")) {
            const result = await scheduler.runOnce();
            process.stderr.write(`Research paper cycle: ${result.status}\n`);
        } else {
            await scheduler.runDaemon();
        }
    } finally {
        database.close();
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${redactError(error)}\n`);
    process.exitCode = 1;
});
