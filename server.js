import "./config/loadEnv.js";
import http from "node:http";
import { collectSingleBusinessLead } from "./agents/leadCollector.js";
import { generateEmailBody } from "./agents/aiEmailWriter.js";
import { extractEmailForLead } from "./agents/emailExtractor.js";
import { calculateLeadScore } from "./agents/leadScorer.js";
import { sendSingleLeadEmail } from "./agents/mailSender.js";
import { analyzeSingleLeadWebsiteSpeed } from "./agents/speedAnalyzer.js";
import { getSubjectLine } from "./agents/subjectGenerator.js";
import { getCampaignState, runCampaignCycle } from "./scheduler/campaignScheduler.js";
import { getRotatedCountry } from "./config/countryConfig.js";
import { getOutreachMode } from "./config/outreachModeConfig.js";
import { getSmtpProviderConfig, getSmtpProviderName } from "./config/smtpConfig.js";
import { getTierMetadata } from "./config/tierConfig.js";
import { connectToMongo, getEmailStats, getSentEmails, updateLead } from "./database/mongo.js";
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

const parseJsonBody = async (request) => {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();
    });

    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
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

const buildSentEmailsPayload = async () => {
  await connectToMongo();
  const sentEmails = await getSentEmails(50);

  return {
    status: "ok",
    count: sentEmails.length,
    sentEmails
  };
};

const runSingleBusinessWorkflow = async ({ businessName, countryName, industry = "manual_test", send = false, ignoreBusinessHours = false }) => {
  await connectToMongo();

  const lead = await collectSingleBusinessLead({ businessName, countryName, industry, maxItems: 5 });

  if (!lead) {
    return {
      status: "not_found",
      message: "No business was collected for the provided query."
    };
  }

  const email = await extractEmailForLead(lead);
  const speed = await analyzeSingleLeadWebsiteSpeed({ ...lead, email });
  const hydratedLead = {
    ...lead,
    email: email ?? lead.email ?? null,
    speedScore: speed.performanceScore,
    slowWebsite: speed.slowWebsite,
    homepageLoadTimeMs: speed.homepageLoadTimeMs
  };
  const score = calculateLeadScore(hydratedLead);
  const subject = getSubjectLine(hydratedLead, `manual-${new Date().toISOString().slice(0, 10)}`);
  const emailBody = await generateEmailBody(hydratedLead);
  const isTarget = score >= Number.parseInt(process.env.MIN_LEAD_SCORE ?? "2", 10);

  if (lead._id) {
    await updateLead(
      { _id: lead._id },
      {
        $set: {
          email: hydratedLead.email,
          speedScore: hydratedLead.speedScore,
          slowWebsite: hydratedLead.slowWebsite,
          homepageLoadTimeMs: hydratedLead.homepageLoadTimeMs,
          score,
          isTarget,
          subjectLine: subject,
          emailBody,
          updatedAt: new Date()
        }
      }
    );
  }

  let sendResult = { sent: false, reason: "preview_only" };

  if (send) {
    sendResult = await sendSingleLeadEmail(
      {
        ...hydratedLead,
        _id: lead._id,
        score,
        isTarget,
        subjectLine: subject,
        emailBody
      },
      { ignoreBusinessHours }
    );
  }

  return {
    status: "ok",
    workflow: {
      collected: true,
      emailExtracted: Boolean(hydratedLead.email),
      speedAnalyzed: hydratedLead.hasWebsite === true,
      scored: true,
      emailGenerated: true,
      sendAttempted: send,
      sendResult
    },
    lead: {
      name: hydratedLead.name,
      website: hydratedLead.website ?? null,
      hasWebsite: hydratedLead.hasWebsite,
      email: hydratedLead.email ?? null,
      city: hydratedLead.city,
      country: hydratedLead.country,
      industry: hydratedLead.industry,
      speedScore: hydratedLead.speedScore ?? null,
      slowWebsite: hydratedLead.slowWebsite ?? false,
      homepageLoadTimeMs: hydratedLead.homepageLoadTimeMs ?? null,
      score,
      isTarget,
      subject,
      emailBody
    }
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

  if (request.method === "POST" && request.url === "/api/workflow/test") {
    if (!isLocalRequest(request)) {
      sendJson(response, 403, {
        status: "forbidden",
        message: "Single-business workflow test is only available from localhost."
      });
      return;
    }

    const body = await parseJsonBody(request);
    const businessName = String(body.businessName ?? "").trim();
    const countryName = String(body.countryName ?? "").trim();
    const industry = String(body.industry ?? "manual_test").trim() || "manual_test";
    const send = body.send === true;
    const ignoreBusinessHours = body.ignoreBusinessHours === true;

    if (!businessName || !countryName) {
      sendJson(response, 400, {
        status: "error",
        message: "businessName and countryName are required."
      });
      return;
    }

    sendJson(response, 200, await runSingleBusinessWorkflow({
      businessName,
      countryName,
      industry,
      send,
      ignoreBusinessHours
    }));
    return;
  }

  if (request.method === "GET" && request.url === "/api/campaign/status") {
    sendJson(response, 200, await buildStatusPayload());
    return;
  }

  if (request.method === "GET" && request.url === "/api/emails/sent") {
    if (!isLocalRequest(request)) {
      sendJson(response, 403, {
        status: "forbidden",
        message: "Sent email history is only available from localhost."
      });
      return;
    }

    sendJson(response, 200, await buildSentEmailsPayload());
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

export { buildSentEmailsPayload, buildStatusPayload, requestHandler, runSingleBusinessWorkflow, startServer };
