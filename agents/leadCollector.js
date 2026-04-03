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
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US,en"
    ]
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

const acceptConsentIfPresent = async (page) => {
  const consentSelectors = [
    'button[aria-label*="Accept"]',
    'button[aria-label*="accept"]',
    'button[aria-label*="Agree"]',
    'button[aria-label*="I agree"]',
    'form button',
    'button'
  ];

  for (const selector of consentSelectors) {
    try {
      const clicked = await page.evaluate((currentSelector) => {
        const buttons = Array.from(document.querySelectorAll(currentSelector));
        const target = buttons.find((button) => {
          const text = (button.innerText || button.textContent || "").trim().toLowerCase();
          const aria = (button.getAttribute("aria-label") || "").trim().toLowerCase();
          return [text, aria].some((value) => value.includes("accept") || value.includes("agree") || value.includes("i agree"));
        });

        if (!target) {
          return false;
        }

        target.click();
        return true;
      }, selector);

      if (clicked) {
        await delay(2000);
        logger.info("google consent accepted", { selector });
        return true;
      }
    } catch (_error) {
      // Ignore and continue trying other selectors.
    }
  }

  return false;
};

const extractLeadCandidates = async (page, requestedIndustry, countryMeta, maxItems) => {
  return page.evaluate((industry, country, limit) => {
    const articleCards = Array.from(document.querySelectorAll('div[role="article"]'));
    const placeAnchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
    const feedCards = Array.from(document.querySelectorAll('[data-result-index], [jsaction*="pane"]'));
    const cards = articleCards.length > 0 ? articleCards : placeAnchors.length > 0 ? placeAnchors : feedCards;
    const seenKeys = new Set();
    const results = [];

    const extractWebsite = (container) => {
      const websiteAnchor = Array.from(container?.querySelectorAll('a[href^="http"]') ?? []).find((link) => {
        const href = link.href ?? "";
        return !href.includes("google.") && !href.includes("googleusercontent.") && !href.includes("/maps/");
      });

      return websiteAnchor?.href ?? null;
    };

    for (const candidate of cards) {
      const card = candidate.closest?.('div[role="article"]') ?? candidate;
      const anchor = card.querySelector?.('a[href*="/maps/place/"]') ?? candidate.querySelector?.('a[href*="/maps/place/"]') ?? candidate;
      const mapsUrl = anchor?.href ?? null;
      const text = card?.innerText ?? anchor?.innerText ?? "";
      const key = mapsUrl || text;

      if (!key || seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);

      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      const businessName = anchor?.getAttribute?.("aria-label")?.trim() || lines[0] || null;

      if (!businessName || businessName.toLowerCase().includes("google") || businessName.toLowerCase().includes("map")) {
        continue;
      }

      const cityLine = lines.find((line) => /,/.test(line)) || lines.find((line) => /\b[A-Z][a-z]+\b/.test(line)) || country.name;
      const website = extractWebsite(card);
      const placeId = mapsUrl ? mapsUrl.split("?")[0] : null;

      results.push({
        name: businessName,
        website,
        hasWebsite: Boolean(website),
        city: cityLine,
        country: country.name,
        mapsUrl,
        placeId,
        industry,
        sourceText: text,
        tier: industry
      });

      if (results.length >= limit) {
        break;
      }
    }

    return {
      articleCardCount: articleCards.length,
      placeAnchorCount: placeAnchors.length,
      feedCardCount: feedCards.length,
      results
    };
  }, requestedIndustry, countryMeta, maxItems);
};

const getPageDiagnostics = async (page) => {
  const title = await page.title();
  const url = page.url();
  const bodyPreview = await page.evaluate(() => {
    return (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  });

  return {
    title,
    url,
    bodyPreview
  };
};

const openMapsByDirectUrl = async (page, query) => {
  await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, {
    waitUntil: "networkidle2",
    timeout: 120000
  });
};

const openMapsBySearchBox = async (page, query) => {
  await page.goto("https://www.google.com/maps", {
    waitUntil: "networkidle2",
    timeout: 120000
  });

  await acceptConsentIfPresent(page);
  await page.waitForSelector('#searchboxinput, input[aria-label="Search Google Maps"]', { timeout: 30000 });
  await page.click('#searchboxinput, input[aria-label="Search Google Maps"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type(query, { delay: 30 });
  await page.keyboard.press("Enter");
  await delay(5000);
};

const openGoogleLocalResults = async (page, query) => {
  await page.goto(`https://www.google.com/search?tbm=lcl&q=${encodeURIComponent(query)}`, {
    waitUntil: "networkidle2",
    timeout: 120000
  });
};

const collectFromQuery = async (page, query, industry, country, searchLimit, scrollRounds) => {
  const strategies = [
    { name: "maps-direct-url", open: () => openMapsByDirectUrl(page, query) },
    { name: "maps-search-box", open: () => openMapsBySearchBox(page, query) },
    { name: "google-local-results", open: () => openGoogleLocalResults(page, query) }
  ];

  for (const strategy of strategies) {
    try {
      await strategy.open();
      await acceptConsentIfPresent(page);
      await delay(3000);

      for (let index = 0; index < scrollRounds; index += 1) {
        await page.mouse.wheel({ deltaY: 1200 });
        await delay(1500);
      }

      const extraction = await extractLeadCandidates(page, industry, country, searchLimit);
      logger.info("lead extraction summary", {
        query,
        strategy: strategy.name,
        articleCardCount: extraction.articleCardCount,
        placeAnchorCount: extraction.placeAnchorCount,
        feedCardCount: extraction.feedCardCount,
        extractedCount: extraction.results.length
      });

      if (extraction.results.length > 0) {
        return extraction.results;
      }

      const diagnostics = await getPageDiagnostics(page);
      logger.warn("lead extraction returned zero results", {
        query,
        strategy: strategy.name,
        ...diagnostics
      });
    } catch (error) {
      logger.warn("lead collection strategy failed", {
        query,
        strategy: strategy.name,
        error: error.message
      });
    }
  }

  return [];
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

      const rawLeads = await collectFromQuery(page, query, industry, country, searchLimit, scrollRounds);

      for (const rawLead of rawLeads) {
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
