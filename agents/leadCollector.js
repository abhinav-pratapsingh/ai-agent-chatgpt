import puppeteer from "puppeteer";
import { inferTimezone, getRotatedCountry } from "../config/countryConfig.js";
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

const normalizeWebsite = (website) => {
  if (!website) {
    return null;
  }

  return website.replace(/\/$/, "");
};

const sanitizeCity = (city, countryName) => {
  const normalizedCity = String(city ?? "").replace(/\s+/g, " ").trim();
  return normalizedCity || countryName;
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

      const leads = await page.evaluate((maxItems, requestedIndustry, countryMeta) => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
        const uniqueAnchors = [];
        const seenHrefs = new Set();

        for (const anchor of anchors) {
          const href = anchor.href;
          if (!href || seenHrefs.has(href)) {
            continue;
          }

          seenHrefs.add(href);
          uniqueAnchors.push(anchor);
        }

        const extractWebsite = (container) => {
          const websiteAnchor = Array.from(container?.querySelectorAll('a[href^="http"]') ?? []).find((link) => {
            const href = link.href ?? "";
            return !href.includes("google.") && !href.includes("googleusercontent.") && !href.includes("/maps/");
          });

          return websiteAnchor?.href ?? null;
        };

        return uniqueAnchors.slice(0, maxItems).map((anchor) => {
          const card = anchor.closest('div[role="article"]') ?? anchor.parentElement ?? anchor;
          const text = card?.innerText ?? anchor.innerText ?? "";
          const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
          const businessName = anchor.getAttribute("aria-label")?.trim() || lines[0] || "Unknown Business";
          const cityLine = lines.find((line) => /,/.test(line)) || lines.find((line) => /\b[A-Z][a-z]+\b/.test(line)) || countryMeta.name;
          const mapsUrl = anchor.href ?? null;
          const website = extractWebsite(card);
          const placeId = mapsUrl ? mapsUrl.split("?")[0] : null;

          return {
            name: businessName,
            website,
            hasWebsite: Boolean(website),
            city: cityLine,
            country: countryMeta.name,
            mapsUrl,
            placeId,
            industry: requestedIndustry,
            sourceText: text,
            tier: requestedIndustry
          };
        });
      }, searchLimit, industry, country);

      for (const rawLead of leads) {
        const city = sanitizeCity(rawLead.city, country.name);
        const lead = {
          ...rawLead,
          website: normalizeWebsite(rawLead.website),
          hasWebsite: Boolean(rawLead.website),
          city,
          country: country.name,
          timezone: inferTimezone(country.name, city),
          industry,
          tier: tierId
        };

        await upsertLead(lead);
        logger.info("lead collected", {
          businessName: lead.name,
          industry: lead.industry,
          city: lead.city,
          hasWebsite: lead.hasWebsite
        });
      }
    }
  } finally {
    await browser.close();
  }
};

export { buildMapsQuery, collectLeads };
