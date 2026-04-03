import "dotenv/config";
import cron from "node-cron";
import { collectLeads } from "../agents/leadCollector.js";
import { extractEmails } from "../agents/emailExtractor.js";
import { scoreLeads } from "../agents/leadScorer.js";
import { sendFollowupEmails, sendOutreachEmails } from "../agents/mailSender.js";
import { analyzeWebsiteSpeed } from "../agents/speedAnalyzer.js";
import { getRotatedCountry } from "../config/countryConfig.js";
import { getOutreachMode } from "../config/outreachModeConfig.js";
import { getTierMetadata } from "../config/tierConfig.js";
import { closeMongoConnection, connectToMongo, resetEmailStatsIfNeeded } from "../database/mongo.js";
import { logger } from "../utils/logger.js";

let isCampaignRunning = false;
const CAMPAIGN_POLL_CRON = process.env.CAMPAIGN_POLL_CRON ?? "*/15 * * * *";
const STATS_RESET_CRON = process.env.STATS_RESET_CRON ?? "0 * * * *";

const runCampaignCycle = async () => {
  if (isCampaignRunning) {
    logger.warn("campaign cycle skipped", { reason: "already running" });
    return;
  }

  isCampaignRunning = true;
  const tier = getTierMetadata();
  const country = getRotatedCountry();

  try {
    await connectToMongo();
    await resetEmailStatsIfNeeded();

    logger.info("tier selected", { tierId: tier.tierId, tierName: tier.name });
    logger.info("country selected", { country: country.name });
    logger.info("mode selected", { mode: getOutreachMode() });

    await collectLeads();
    await extractEmails();
    await analyzeWebsiteSpeed();
    await scoreLeads();
    await sendOutreachEmails();
    await sendFollowupEmails();
  } catch (error) {
    logger.error("campaign cycle failed", { error: error.message, stack: error.stack });
  } finally {
    isCampaignRunning = false;
  }
};

const startScheduler = async () => {
  await connectToMongo();
  logger.info("campaign scheduler started", {
    campaignPollCron: CAMPAIGN_POLL_CRON,
    statsResetCron: STATS_RESET_CRON
  });

  cron.schedule(STATS_RESET_CRON, async () => {
    await resetEmailStatsIfNeeded();
  });

  cron.schedule(CAMPAIGN_POLL_CRON, async () => {
    await runCampaignCycle();
  });

  await runCampaignCycle();
};

process.on("SIGINT", async () => {
  await closeMongoConnection();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeMongoConnection();
  process.exit(0);
});

if (process.argv[1] && process.argv[1].endsWith("campaignScheduler.js")) {
  startScheduler().catch((error) => {
    logger.error("scheduler startup failed", { error: error.message });
    process.exit(1);
  });
}

export { runCampaignCycle, startScheduler };
