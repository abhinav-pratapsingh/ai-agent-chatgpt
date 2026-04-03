import "dotenv/config";
import http from "node:http";
import { runCampaignCycle } from "./scheduler/campaignScheduler.js";
import { getRotatedCountry } from "./config/countryConfig.js";
import { getOutreachMode } from "./config/outreachModeConfig.js";
import { getSmtpProviderName } from "./config/smtpConfig.js";
import { getTierMetadata } from "./config/tierConfig.js";
import { connectToMongo } from "./database/mongo.js";
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

const requestHandler = async (request, response) => {
  if (request.method === "POST" && request.url === "/api/campaign/run") {
    if (!isLocalRequest(request)) {
      sendJson(response, 403, {
        status: "forbidden",
        message: "Manual campaign trigger is only available from localhost."
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
  await connectToMongo();

  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      logger.error("request failed", { error: error.message });
      response.writeHead(500, {
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({ status: "error" }));
    });
  });

  server.listen(port, () => {
    logger.info("server started", { port });
  });
};

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  startServer().catch((error) => {
    logger.error("server startup failed", { error: error.message });
    process.exit(1);
  });
}

export { requestHandler, startServer };
