import "dotenv/config";
import http from "node:http";
import { getRotatedCountry } from "./config/countryConfig.js";
import { getOutreachMode } from "./config/outreachModeConfig.js";
import { getSmtpProviderName } from "./config/smtpConfig.js";
import { getTierMetadata } from "./config/tierConfig.js";
import { connectToMongo } from "./database/mongo.js";
import { logger } from "./utils/logger.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const requestHandler = async (_request, response) => {
  const tier = getTierMetadata();
  const country = getRotatedCountry();

  response.writeHead(200, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify({
    service: "AI Outreach Agent",
    status: "ok",
    tier: tier.name,
    country: country.name,
    outreachMode: getOutreachMode(),
    smtpProvider: getSmtpProviderName(),
    timestamp: new Date().toISOString()
  }));
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
