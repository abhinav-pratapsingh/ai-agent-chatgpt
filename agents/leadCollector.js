import puppeteer from "puppeteer";
import { inferTimezone, getRotatedCountry } from "../config/countryConfig.js";
import { getTierMetadata } from "../config/tierConfig.js";
import { upsertLead } from "../database/mongo.js";
import { delay } from "../utils/delay.js";
import { logger } from "../utils/logger.js";

const consentPhrases = [
  "accept all",
  "i agree",
  "agree",
  "accept",
  "godkänn alla",
  "jag godkänner",
  "acceptera",
  "tillåt alla",
  "allow all"
];

const openBrowser = async () => {
  return puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US,en-GB,en"
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

const looksLikeConsentText = (text) => {
  const normalizedText = String(text ?? "").trim().toLowerCase();
  return consentPhrases.some((phrase) => normalizedText.includes(phrase));
};

const preloadGoogleContext = async (page) => {
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8"
  });

  await page.goto("https://www.google.com/ncr", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.setCookie({
    name: "SOCS",
    value: "CAESHAgBEhIaAB",
    domain: ".google.com",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "None"
  });
};

const acceptConsentIfPresent = async (page) => {
  const clicked = await page.evaluate((phrases) => {
    const isMatch = (value) => {
      const normalizedValue = String(value ?? "").trim().toLowerCase();
      return phrases.some((phrase) => normalizedValue.includes(phrase));
    };

    const clickableElements = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a'));
    const target = clickableElements.find((element) => {
      const text = element.innerText || element.textContent || "";
      const aria = element.getAttribute("aria-label") || "";
      const value = element.getAttribute("value") || "";
      return [text, aria, value].some((candidate) => isMatch(candidate));
    });

    if (!target) {
      return null;
    }

    target.click();
    return {
      text: (target.innerText || target.textContent || target.getAttribute("aria-label") || target.getAttribute("value") || "").trim()
    };
  }, consentPhrases);

  if (!clicked) {
    return false;
  }

  logger.info("google consent accepted", { matchedText: clicked.text });
  await delay(4000);
  return true;
};

const ensureUsableGooglePage = async (page, targetUrl) => {
  if (!page.url().includes("consent.google.com")) {
    return;
  }

  const diagnostics = await getPageDiagnostics(page);
  logger.warn("google consent redirect detected", diagnostics);

  const accepted = await acceptConsentIfPresent(page);

  if (!accepted) {
    throw new Error("Google consent page detected but no consent button was matched.");
  }

  await page.goto(targetUrl, {
    waitUntil: "networkidle2",
    timeout: 120000
  });
  await delay(3000);
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
  const targetUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en&gl=GB`;
  await page.goto(targetUrl, {
    waitUntil: "networkidle2",
    timeout: 120000
  });
  await ensureUsableGooglePage(page, targetUrl);
};

const openMapsBySearchBox = async (page, query) => {
  const targetUrl = "https://www.google.com/maps?hl=en&gl=GB";
  await page.goto(targetUrl, {
    waitUntil: "networkidle2",
    timeout: 120000
  });

  await ensureUsableGooglePage(page, targetUrl);
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
  const targetUrl = `https://www.google.com/search?tbm=lcl&hl=en&gl=GB&q=${encodeURIComponent(query)}`;
  await page.goto(targetUrl, {
    waitUntil: "networkidle2",
    timeout: 120000
  });
  await ensureUsableGooglePage(page, targetUrl);
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
        consentLikePage: looksLikeConsentText(diagnostics.bodyPreview),
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
    await preloadGoogleContext(page);

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
