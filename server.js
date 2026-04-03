import "./config/loadEnv.js";
import http from "node:http";
import { getCampaignState, runCampaignCycle } from "./scheduler/campaignScheduler.js";
import { getRotatedCountry } from "./config/countryConfig.js";
import { getOutreachMode } from "./config/outreachModeConfig.js";
import { getSmtpProviderConfig, getSmtpProviderName } from "./config/smtpConfig.js";
import { getTierMetadata } from "./config/tierConfig.js";
import { connectToMongo, getEmailStats } from "./database/mongo.js";
import { logger } from "./utils/logger.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const isLocalRequest = (request) => {
  const remoteAddress = request.socket?.remoteAddress ?? "";
  return remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1" || remoteAddress === "127.0.0.1";
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload));
};

const buildStatusPayload = async () => {
  const tier = getTierMetadata();
  const country = getRotatedCountry();
  const campaignState = getCampaignState();
  const smtpProvider = getSmtpProviderConfig();

  let emailStats = {
    emailsSentToday: 0,
    emailsSentThisHour: 0
  };

  try {
    await connectToMongo();
    emailStats = await getEmailStats(smtpProvider.name);
  } catch (error) {
    logger.warn("status endpoint using degraded mongo-free response", { error: error.message });
  }

  return {
    status: campaignState.isCampaignRunning ? "running" : "idle",
    timestamp: new Date().toISOString(),
    config: {
      tier: `${tier.tierId} - ${tier.name}`,
      country: country.name,
      mode: getOutreachMode(),
      smtp: getSmtpProviderName()
    },
    emailsToday: emailStats.emailsSentToday,
    dailyLimit: smtpProvider.dailyLimit,
    emailsThisHour: emailStats.emailsSentThisHour,
    hourlyLimit: smtpProvider.hourlyLimit
  };
};

const requestHandler = async (request, response) => {
  if (request.method === "POST" && request.url === "/api/campaign/run") {
    if (!isLocalRequest(request)) {
      sendJson(response, 403, {
        status: "forbidden",
        message: "Manual campaign trigger is only available from localhost."
      });
      return;
    }

    const campaignState = getCampaignState();

    if (campaignState.isCampaignRunning) {
      sendJson(response, 409, {
        status: "busy",
        message: "Campaign cycle is already running."
      });
      return;
    }

    logger.info("manual campaign trigger received", {
      remoteAddress: request.socket?.remoteAddress ?? "unknown"
    });

    runCampaignCycle().catch((error) => {
      logger.error("manual campaign trigger failed", { error: error.message, stack: error.stack });
    });

    sendJson(response, 202, {
      status: "accepted",
      message: "Campaign cycle started."
    });
    return;
  }

  if (request.method === "GET" && request.url === "/api/campaign/status") {
    sendJson(response, 200, await buildStatusPayload());
    return;
  }

  const tier = getTierMetadata();
  const country = getRotatedCountry();

  sendJson(response, 200, {
    service: "AI Outreach Agent",
    status: "ok",
    tier: tier.name,
    country: country.name,
    outreachMode: getOutreachMode(),
    smtpProvider: getSmtpProviderName(),
    timestamp: new Date().toISOString()
  });
};

const startServer = async () => {
  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      logger.error("request failed", { error: error.message, stack: error.stack });
      sendJson(response, 500, { status: "error" });
    });
  });

  server.listen(port, () => {
    logger.info("server started", { port });
  });

  connectToMongo()
    .then(() => {
      logger.info("mongo connection ready for api server");
    })
    .catch((error) => {
      logger.error("api server mongo startup failed", { error: error.message, stack: error.stack });
    });
};

if (process.env.START_MODE === "api" || (process.argv[1] && process.argv[1].endsWith("server.js"))) {
  startServer().catch((error) => {
    logger.error("server startup failed", { error: error.message });
    process.exit(1);
  });
}

export { buildStatusPayload, requestHandler, startServer };


