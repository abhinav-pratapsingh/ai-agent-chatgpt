import lighthouse from "lighthouse";
import puppeteer from "puppeteer";
import { findLeads, updateLead } from "../database/mongo.js";
import { logger } from "../utils/logger.js";

const analyzeSingleLeadWebsiteSpeed = async (lead) => {
  if (!lead?.website) {
    return {
      performanceScore: null,
      homepageLoadTimeMs: null,
      slowWebsite: false
    };
  }

  const threshold = Number.parseInt(process.env.SLOW_WEBSITE_THRESHOLD ?? "60", 10);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--remote-debugging-port=0"]
    });

    const endpoint = new URL(browser.wsEndpoint());
    const port = Number.parseInt(endpoint.port, 10);
    const result = await lighthouse(
      lead.website,
      {
        port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"]
      },
      undefined
    );

    const performanceScore = Math.round((result.lhr.categories.performance.score ?? 0) * 100);
    const homepageLoadTimeMs = Math.round(result.lhr.audits.interactive?.numericValue ?? 0);
    const slowWebsite = performanceScore < threshold;

    if (lead._id) {
      await updateLead(
        { _id: lead._id },
        {
          $set: {
            speedScore: performanceScore,
            slowWebsite,
            homepageLoadTimeMs,
            updatedAt: new Date()
          }
        }
      );
    }

    logger.info("speed tested", {
      businessName: lead.name,
      score: performanceScore,
      slowWebsite
    });

    return {
      performanceScore,
      homepageLoadTimeMs,
      slowWebsite
    };
  } catch (error) {
    logger.warn("speed analysis failed", {
      businessName: lead.name,
      website: lead.website,
      error: error.message
    });

    return {
      performanceScore: null,
      homepageLoadTimeMs: null,
      slowWebsite: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const analyzeWebsiteSpeed = async () => {
  const leads = await findLeads({
    hasWebsite: true,
    website: { $ne: null },
    $or: [
      { speedScore: null },
      { speedScore: { $exists: false } }
    ]
  });

  if (leads.length === 0) {
    logger.info("speed analysis skipped", { reason: "no leads pending" });
    return;
  }

  for (const lead of leads) {
    await analyzeSingleLeadWebsiteSpeed(lead);
  }
};

export { analyzeSingleLeadWebsiteSpeed, analyzeWebsiteSpeed };
