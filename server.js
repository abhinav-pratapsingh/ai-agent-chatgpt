import "./config/loadEnv.js";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSingleBusinessLead } from "./agents/leadCollector.js";
import { generateEmailBody } from "./agents/aiEmailWriter.js";
import { extractEmailForLead } from "./agents/emailExtractor.js";
import { calculateLeadScore } from "./agents/leadScorer.js";
import { sendSingleLeadEmail } from "./agents/mailSender.js";
import { analyzeSingleLeadWebsiteSpeed } from "./agents/speedAnalyzer.js";
import { getSubjectLine } from "./agents/subjectGenerator.js";
import { getCountryTimezone, getRotatedCountry, supportedCountries } from "./config/countryConfig.js";
import { getOutreachMode } from "./config/outreachModeConfig.js";
import { getSmtpProviderConfig, getSmtpProviderName, smtpProviders } from "./config/smtpConfig.js";
import { getTierMetadata, tierDefinitions } from "./config/tierConfig.js";
import { connectToMongo, countLeads, getEmailStats, getRecentLeads, getRecentLogs, getSentEmails, updateLead } from "./database/mongo.js";
import { logger } from "./utils/logger.js";
import { getCampaignState, runCampaignCycle } from "./scheduler/campaignScheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const adminApiKey = String(process.env.ADMIN_API_KEY ?? "").trim();
const allowedOrigins = String(process.env.FRONTEND_ORIGIN ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const isLocalRequest = (request) => {
  const remoteAddress = request.socket?.remoteAddress ?? "";
  return remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1" || remoteAddress === "127.0.0.1";
};

const getCorsOrigin = (request) => {
  const origin = request.headers.origin;

  if (!origin) {
    return null;
  }

  if (allowedOrigins.includes("*")) {
    return "*";
  }

  return allowedOrigins.includes(origin) ? origin : null;
};

const getResponseHeaders = (request, extraHeaders = {}) => {
  const headers = {
    ...extraHeaders
  };
  const corsOrigin = getCorsOrigin(request);

  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Admin-Key";
  }

  return headers;
};

const sendJson = (request, response, statusCode, payload) => {
  response.writeHead(statusCode, getResponseHeaders(request, {
    "Content-Type": "application/json"
  }));
  response.end(JSON.stringify(payload));
};

const sendText = (request, response, statusCode, contentType, body) => {
  response.writeHead(statusCode, getResponseHeaders(request, {
    "Content-Type": contentType
  }));
  response.end(body);
};

const hasAdminAccess = (request) => {
  if (isLocalRequest(request)) {
    return true;
  }

  if (!adminApiKey) {
    return false;
  }

  return request.headers["x-admin-key"] === adminApiKey;
};

const requireAdminAccess = (request, response, message = "Admin access required.") => {
  if (hasAdminAccess(request)) {
    return true;
  }

  sendJson(request, response, 403, {
    status: "forbidden",
    message
  });
  return false;
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

const buildLeadStatus = (lead) => {
  if (lead.contacted) {
    return "Sent";
  }

  if (lead.isTarget && lead.email) {
    return "Queued";
  }

  if (lead.isTarget) {
    return "Qualified";
  }

  return "Skipped";
};

const buildRecentLeadRow = (lead) => {
  return {
    id: lead._id?.toString?.() ?? "",
    business: lead.name,
    industry: lead.industry,
    city: lead.city,
    country: lead.country,
    score: lead.score ?? 0,
    website: lead.hasWebsite ? "Yes" : "None",
    websiteUrl: lead.website ?? null,
    speedScore: lead.speedScore ?? null,
    email: lead.email ?? null,
    status: buildLeadStatus(lead),
    contacted: Boolean(lead.contacted),
    followupSent: Boolean(lead.followupSent),
    subjectLine: lead.subjectLine ?? null,
    emailBody: lead.emailBody ?? null,
    updatedAt: lead.updatedAt ?? null
  };
};

const buildSentEmailRow = (lead) => {
  return {
    id: lead._id?.toString?.() ?? "",
    business: lead.name,
    recipient: lead.email ?? null,
    city: lead.city,
    country: lead.country,
    industry: lead.industry,
    subject: lead.subjectLine ?? "",
    emailBody: lead.emailBody ?? "",
    followupBody: lead.followupBody ?? "",
    contactedDate: lead.contactedDate ?? null,
    followupSent: Boolean(lead.followupSent),
    nextFollowupAt: lead.nextFollowupAt ?? null,
    website: lead.website ?? null,
    hasWebsite: Boolean(lead.hasWebsite),
    speedScore: lead.speedScore ?? null,
    homepageLoadTimeMs: lead.homepageLoadTimeMs ?? null,
    score: lead.score ?? 0
  };
};

const buildDashboardPayload = async () => {
  await connectToMongo();

  const tier = getTierMetadata();
  const country = getRotatedCountry();
  const smtpProvider = getSmtpProviderConfig();
  const emailStats = await getEmailStats(smtpProvider.name);
  const [
    totalLeads,
    qualifiedLeads,
    noWebsiteLeads,
    slowWebsiteLeads,
    emailsFound,
    contactedTotal,
    followupsDue,
    recentLeads,
    recentLogs,
    sentEmails
  ] = await Promise.all([
    countLeads({}),
    countLeads({ isTarget: true }),
    countLeads({ hasWebsite: false }),
    countLeads({ slowWebsite: true }),
    countLeads({ email: { $nin: [null, ""] } }),
    countLeads({ contacted: true }),
    countLeads({ contacted: true, followupSent: false, nextFollowupAt: { $lte: new Date() } }),
    getRecentLeads(12),
    getRecentLogs(50),
    getSentEmails(25)
  ]);

  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    summary: {
      emailsToday: emailStats.emailsSentToday,
      dailyLimit: smtpProvider.dailyLimit,
      emailsThisHour: emailStats.emailsSentThisHour,
      hourlyLimit: smtpProvider.hourlyLimit,
      qualifiedLeads,
      followupsDue,
      contactedTotal,
      noWebsiteLeads,
      slowWebsiteLeads,
      emailsFound,
      totalLeads
    },
    progress: {
      dailyQuotaLabel: `${emailStats.emailsSentToday}/${smtpProvider.dailyLimit}`,
      hourlyQuotaLabel: `${emailStats.emailsSentThisHour}/${smtpProvider.hourlyLimit}`,
      leadsCollectedLabel: `${totalLeads}/${Math.max(totalLeads, 200)}`,
      emailsExtractedLabel: `${emailsFound}/${Math.max(totalLeads, 1)}`
    },
    activeConfig: {
      status: getCampaignState().isCampaignRunning ? "Running" : "Idle",
      smtpProvider: getSmtpProviderName(),
      tier: `Tier ${tier.tierId} - ${tier.name}`,
      tierId: tier.tierId,
      country: country.name,
      supportedCountries: supportedCountries.map((item) => item.name),
      outreachMode: getOutreachMode(),
      aiEngine: process.env.OLLAMA_ENABLED === "true" ? `${process.env.OLLAMA_MODEL ?? "llama3"} (Ollama)` : "Template writer",
      sendingWindow: `9 AM - 6 PM local time (${getCountryTimezone(country.name)})`,
      minLeadScore: Number.parseInt(process.env.MIN_LEAD_SCORE ?? "2", 10),
      pollCron: getCampaignState().campaignPollCron,
      testMode: process.env.TEST_MODE === "true"
    },
    providerComparison: Object.entries(smtpProviders).map(([name, provider]) => ({
      name,
      dailyLimit: provider.dailyLimit,
      hourlyLimit: provider.hourlyLimit
    })),
    tiers: Object.entries(tierDefinitions).map(([id, definition]) => ({
      id: Number(id),
      name: definition.name,
      industries: definition.industries.length
    })),
    recentLeads: recentLeads.map(buildRecentLeadRow),
    sentEmails: sentEmails.map(buildSentEmailRow),
    liveLogs: recentLogs
      .map((entry) => ({
        id: entry._id?.toString?.() ?? "",
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        meta: entry.meta ?? null,
        processName: entry.processName ?? null
      }))
      .reverse()
  };
};

const buildSentEmailsPayload = async () => {
  await connectToMongo();
  const sentEmails = await getSentEmails(100);

  return {
    status: "ok",
    count: sentEmails.length,
    sentEmails: sentEmails.map(buildSentEmailRow)
  };
};

const buildRecentLeadsPayload = async () => {
  await connectToMongo();
  const leads = await getRecentLeads(50);
  return {
    status: "ok",
    count: leads.length,
    leads: leads.map(buildRecentLeadRow)
  };
};

const buildLogsPayload = async () => {
  await connectToMongo();
  const logs = await getRecentLogs(150);
  return {
    status: "ok",
    count: logs.length,
    logs: logs.reverse().map((entry) => ({
      id: entry._id?.toString?.() ?? "",
      timestamp: entry.timestamp,
      level: entry.level,
      message: entry.message,
      meta: entry.meta ?? null,
      processName: entry.processName ?? null
    }))
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

const serveStaticFile = async (request, response, pathname) => {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname === "/login" ? "/login.html" : pathname === "/dashboard" ? "/dashboard.html" : pathname === "/emails" ? "/emails.html" : pathname;
  const filePath = path.join(publicDir, normalizedPath.replace(/^\/+/, ""));

  if (!filePath.startsWith(publicDir)) {
    sendJson(request, response, 403, { status: "forbidden" });
    return true;
  }

  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, getResponseHeaders(request, {
      "Content-Type": contentTypes[extension] ?? "application/octet-stream"
    }));
    response.end(content);
    return true;
  } catch {
    return false;
  }
};

const requestHandler = async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, getResponseHeaders(request));
    response.end();
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/campaign/run") {
    if (!requireAdminAccess(request, response, "Manual campaign trigger requires admin access.")) {
      return;
    }

    const campaignState = getCampaignState();

    if (campaignState.isCampaignRunning) {
      sendJson(request, response, 409, {
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

    sendJson(request, response, 202, {
      status: "accepted",
      message: "Campaign cycle started."
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/workflow/test") {
    if (!requireAdminAccess(request, response, "Single-business workflow test requires admin access.")) {
      return;
    }

    const body = await parseJsonBody(request);
    const businessName = String(body.businessName ?? "").trim();
    const countryName = String(body.countryName ?? "").trim();
    const industry = String(body.industry ?? "manual_test").trim() || "manual_test";
    const send = body.send === true;
    const ignoreBusinessHours = body.ignoreBusinessHours === true;

    if (!businessName || !countryName) {
      sendJson(request, response, 400, {
        status: "error",
        message: "businessName and countryName are required."
      });
      return;
    }

    sendJson(request, response, 200, await runSingleBusinessWorkflow({
      businessName,
      countryName,
      industry,
      send,
      ignoreBusinessHours
    }));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/campaign/status") {
    sendJson(request, response, 200, await buildStatusPayload());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
    if (!requireAdminAccess(request, response, "Dashboard data requires admin access.")) {
      return;
    }

    sendJson(request, response, 200, await buildDashboardPayload());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/leads/recent") {
    if (!requireAdminAccess(request, response, "Lead data requires admin access.")) {
      return;
    }

    sendJson(request, response, 200, await buildRecentLeadsPayload());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/logs/recent") {
    if (!requireAdminAccess(request, response, "Log data requires admin access.")) {
      return;
    }

    sendJson(request, response, 200, await buildLogsPayload());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/emails/sent") {
    if (!requireAdminAccess(request, response, "Sent email history requires admin access.")) {
      return;
    }

    sendJson(request, response, 200, await buildSentEmailsPayload());
    return;
  }

  if (!requestUrl.pathname.startsWith("/api/")) {
    if (await serveStaticFile(request, response, requestUrl.pathname)) {
      return;
    }
  }

  const tier = getTierMetadata();
  const country = getRotatedCountry();

  sendJson(request, response, 200, {
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
      sendJson(request, response, 500, { status: "error" });
    });
  });

  server.listen(port, () => {
    logger.info("server started", { port, allowedOrigins });
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

export {
  buildDashboardPayload,
  buildLogsPayload,
  buildRecentLeadsPayload,
  buildSentEmailsPayload,
  buildStatusPayload,
  requestHandler,
  runSingleBusinessWorkflow,
  startServer
};

