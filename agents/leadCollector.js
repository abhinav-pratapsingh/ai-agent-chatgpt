import puppeteer from "puppeteer";
import { getRotatedCountry } from "../config/countryConfig.js";
import { getTierMetadata } from "../config/tierConfig.js";
import { upsertLead } from "../database/mongo.js";
import { delay } from "../utils/delay.js";
import { logger } from "../utils/logger.js";

const openBrowser = async () => {
  return puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
};

const buildMapsQuery = (industry, countryName) => {
  return `${industry} in ${countryName}`;
};

const collectLeads = async () => {
  const { tierId, name: tierName, industries } = getTierMetadata();
  const country = getRotatedCountry();
  const searchLimit = Number.parseInt(process.env.CAMPAIGN_SEARCH_LIMIT ?? "25", 10);
  const scrollRounds = Number.parseInt(process.env.GOOGLE_MAPS_SCROLL_ROUNDS ?? "8", 10);
  const browser = await openBrowser();

  logger.info("tier selected", { tierId, tierName });
  logger.info("country selected", { country: country.name });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(process.env.USER_AGENT ?? "Mozilla/5.0");
    await page.setViewport({ width: 1440, height: 900 });

    for (const industry of industries) {
      const query = buildMapsQuery(industry, country.name);
      logger.info("collecting leads", { query });

      await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, {
        waitUntil: "networkidle2",
        timeout: 120000
      });

      await delay(3000);

      for (let index = 0; index < scrollRounds; index += 1) {
        await page.mouse.wheel({ deltaY: 1200 });
        await delay(1500);
      }

      const leads = await page.evaluate((maxItems, tierValue, countryMeta) => {
        const cards = Array.from(document.querySelectorAll("a.hfpxzc"));

        return cards.slice(0, maxItems).map((card) => {
          const container = card.closest("div[role='article']") ?? card.parentElement;
          const text = container?.innerText ?? "";
          const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
          const businessName = lines[0] ?? "Unknown Business";
          const city = lines.find((line) => /,/.test(line)) ?? countryMeta.name;
          const websiteMatch = text.match(/https?:\/\/[^\s]+/i);

          return {
            name: businessName,
            website: websiteMatch?.[0] ?? null,
            hasWebsite: Boolean(websiteMatch?.[0]),
            city,
            country: countryMeta.name,
            timezone: countryMeta.timezones[0] ?? "UTC",
            industry: lines[1] ?? "unknown",
            tier: tierValue
          };
        });
      }, searchLimit, tierId, country);

      for (const lead of leads) {
        await upsertLead(lead);
        logger.info("lead collected", {
          businessName: lead.name,
          industry: lead.industry,
          city: lead.city
        });
      }
    }
  } finally {
    await browser.close();
  }
};

export { buildMapsQuery, collectLeads };
