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
  "godkann alla",
  "jag godkanner",
  "acceptera",
  "tillat alla",
  "allow all"
];

const ignoredBusinessPhrases = [
  "collapse side panel",
  "directions",
  "website",
  "share",
  "save",
  "nearby",
  "send to phone",
  "copy link",
  "overview",
  "reviews",
  "photos",
  "updates",
  "about"
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

const buildBusinessQuery = (businessName, countryName) => {
  return `${businessName} ${countryName}`.trim();
};

const normalizeWebsite = (website) => {
  if (!website) {
    return null;
  }

  return website.replace(/\/$/, "");
};

const normalizeText = (value) => {
  return String(value ?? "").replace(/\s+/g, " ").trim();
};

const sanitizeCity = (city, countryName) => {
  const normalizedCity = normalizeText(city)
    .replace(/^[^A-Za-z]+/, "")
    .replace(/^(Level|Shop|Suite|Unit|Floor)\b.*?,\s*/i, "")
    .replace(/^(\d+[A-Za-z-]*\/?\d*\s+[^,]+,\s*)+/i, "")
    .replace(/^(Floor\s*\d+\s*[\-|,]?\s*)/i, "")
    .replace(/^(?:Level|Shop|Suite|Unit|Floor)\s*\d+\b.*$/i, "")
    .trim();

  return normalizedCity || countryName;
};

const isIgnoredBusinessName = (value) => {
  const normalizedValue = normalizeText(value).toLowerCase();
  return !normalizedValue || ignoredBusinessPhrases.some((phrase) => normalizedValue.includes(phrase));
};

const looksLikeConsentText = (text) => {
  const normalizedText = String(text ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
    const normalize = (value) => String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isMatch = (value) => {
      const normalizedValue = normalize(value);
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

const extractResultHandles = async (page) => {
  await page.waitForSelector('div[role="article"], a[href*="/maps/place/"]', { timeout: 30000 }).catch(() => {});
  return page.$$eval('div[role="article"]', (cards) => cards.map((_card, index) => index));
};

const extractCardSummaryAtIndex = async (page, index) => {
  return page.evaluate((cardIndex) => {
    const cards = Array.from(document.querySelectorAll('div[role="article"]'));
    const card = cards[cardIndex];

    if (!card) {
      return null;
    }

    const anchor = card.querySelector('a[href*="/maps/place/"]');
    const text = card.innerText ?? "";
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      text,
      lines,
      ariaLabel: anchor?.getAttribute("aria-label")?.trim() ?? null,
      mapsUrl: anchor?.href ?? null
    };
  }, index);
};

const openPlaceDetailsFromCard = async (page, index) => {
  const clicked = await page.evaluate((cardIndex) => {
    const cards = Array.from(document.querySelectorAll('div[role="article"]'));
    const card = cards[cardIndex];
    if (!card) {
      return false;
    }

    const target = card.querySelector('a[href*="/maps/place/"]') ?? card;
    target.click();
    return true;
  }, index);

  if (!clicked) {
    return false;
  }

  await delay(4000);
  return true;
};

const extractCityFromAddress = (address, country) => {
  const addressParts = String(address ?? "").split(',').map((part) => part.trim()).filter(Boolean);
  const statePattern = /\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT|England|Scotland|Wales|Victoria|Queensland|Ontario|British Columbia|California|Texas|New York)\b/i;

  for (let index = addressParts.length - 1; index >= 0; index -= 1) {
    const part = addressParts[index];

    if (!part || part.toLowerCase() === country.toLowerCase()) {
      continue;
    }

    if (/^\d+[A-Za-z-]*\/?\d*\s+/.test(part) || /^level\b/i.test(part)) {
      continue;
    }

    if (statePattern.test(part)) {
      const cityMatch = part.match(/^([A-Za-z][A-Za-z\s.'-]+?)\s+(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}$/i);

      if (cityMatch?.[1]) {
        return cityMatch[1].trim();
      }

      continue;
    }

    if (/[A-Za-z]/.test(part)) {
      const normalizedPart = part.replace(/\b\d{4,}\b/g, "").trim();

      if (normalizedPart) {
        return normalizedPart;
      }
    }
  }

  const stateCityMatch = String(address ?? "").match(/\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*)\s+(?:VIC|NSW|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/);
  if (stateCityMatch?.[1]) {
    return stateCityMatch[1].trim();
  }

  return country;
};

const extractPlaceDetails = async (page, fallbackIndustry, countryName) => {
  return page.evaluate((industry, country) => {
    const getText = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const value = (element?.innerText || element?.textContent || "").trim();
        if (value) {
          return value;
        }
      }
      return null;
    };

    const getHref = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const href = element?.href?.trim();
        if (href) {
          return href;
        }
      }
      return null;
    };

    const title = getText(['h1', 'h1 span', '[role="main"] h1']);
    const address = getText(['button[data-item-id="address"]', 'button[aria-label*="Address"]', '[data-item-id="address"]']);
    const category = getText(['button[jsaction*="category"]', 'button[aria-label*="Category"]']);
    const website = getHref(['a[data-item-id="authority"]', 'a[aria-label*="Website"]', 'a[data-tooltip*="website"]']);
    const phone = getText(['button[data-item-id^="phone"]', 'button[aria-label*="Phone"]']);
    const panelText = (document.querySelector('[role="main"]')?.innerText ?? document.body?.innerText ?? '').trim();

    return {
      name: title,
      address,
      country,
      industry: category || industry,
      website,
      hasWebsite: Boolean(website),
      phone,
      sourceText: panelText,
      mapsUrl: window.location.href,
      placeId: window.location.href.split('?')[0]
    };
  }, fallbackIndustry, countryName).then((details) => {
    return {
      ...details,
      city: extractCityFromAddress(details.address, countryName)
    };
  });
};

const buildLeadFromPlaceDetails = (details, countryName, industry, tierId) => {
  const city = sanitizeCity(details.city, countryName);
  return {
    ...details,
    name: normalizeText(details.name),
    website: normalizeWebsite(details.website),
    hasWebsite: Boolean(details.website),
    city,
    address: normalizeText(details.address),
    country: countryName,
    timezone: inferTimezone(countryName, city),
    industry: details.industry || industry,
    tier: tierId
  };
};

const isDirectPlacePage = (page) => {
  const currentUrl = page.url();
  return currentUrl.includes('/maps/place/') || currentUrl.includes('google.com/maps/place/');
};

const collectFromQuery = async (page, query, industry, country, searchLimit, scrollRounds, tierId) => {
  const strategies = [
    { name: "maps-direct-url", open: () => openMapsByDirectUrl(page, query) },
    { name: "maps-search-box", open: () => openMapsBySearchBox(page, query) },
    { name: "google-local-results", open: () => openGoogleLocalResults(page, query) }
  ];

  for (const strategy of strategies) {
    try {
      await strategy.open();
      await delay(3000);

      if (isDirectPlacePage(page)) {
        const details = await extractPlaceDetails(page, industry, country.name);
        const lead = buildLeadFromPlaceDetails(details, country.name, industry, tierId);

        logger.info("lead extraction summary", {
          query,
          strategy: strategy.name,
          articleCardCount: 0,
          placeAnchorCount: 0,
          feedCardCount: 0,
          extractedCount: isIgnoredBusinessName(lead.name) ? 0 : 1,
          directPlacePage: true
        });

        if (!isIgnoredBusinessName(lead.name)) {
          return [lead];
        }
      }

      for (let index = 0; index < scrollRounds; index += 1) {
        await page.mouse.wheel({ deltaY: 1200 });
        await delay(1500);
      }

      const cardIndexes = await extractResultHandles(page);
      const results = [];

      for (const cardIndex of cardIndexes) {
        if (results.length >= searchLimit) {
          break;
        }

        const summary = await extractCardSummaryAtIndex(page, cardIndex);
        const candidateName = normalizeText(summary?.ariaLabel || summary?.lines?.[0] || "");

        if (isIgnoredBusinessName(candidateName)) {
          continue;
        }

        const opened = await openPlaceDetailsFromCard(page, cardIndex);
        if (!opened) {
          continue;
        }

        const details = await extractPlaceDetails(page, industry, country.name);
        const lead = buildLeadFromPlaceDetails(details, country.name, industry, tierId);

        if (isIgnoredBusinessName(lead.name)) {
          await openMapsByDirectUrl(page, query);
          await delay(3000);
          continue;
        }

        results.push(lead);
        await openMapsByDirectUrl(page, query);
        await delay(3000);
      }

      logger.info("lead extraction summary", {
        query,
        strategy: strategy.name,
        articleCardCount: cardIndexes.length,
        placeAnchorCount: cardIndexes.length,
        feedCardCount: cardIndexes.length,
        extractedCount: results.length
      });

      if (results.length > 0) {
        return results;
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

const collectLeadSet = async ({ queries, country, searchLimit, scrollRounds, tierId }) => {
  const browser = await openBrowser();
  const collectedLeads = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(process.env.USER_AGENT ?? "Mozilla/5.0");
    await page.setViewport({ width: 1440, height: 900 });
    await preloadGoogleContext(page);

    for (const queryConfig of queries) {
      logger.info("collecting leads", { query: queryConfig.query });
      const leads = await collectFromQuery(page, queryConfig.query, queryConfig.industry, country, queryConfig.maxItems ?? searchLimit, scrollRounds, tierId);

      for (const lead of leads) {
        await upsertLead(lead);
        collectedLeads.push(lead);
        logger.info("lead collected", {
          businessName: lead.name,
          industry: lead.industry,
          city: lead.city,
          hasWebsite: lead.hasWebsite,
          website: lead.website ?? null
        });
      }
    }
  } finally {
    await browser.close();
  }

  return collectedLeads;
};

const collectLeads = async () => {
  const { tierId, name: tierName, industries } = getTierMetadata();
  const country = getRotatedCountry();
  const searchLimit = Number.parseInt(process.env.CAMPAIGN_SEARCH_LIMIT ?? "25", 10);
  const scrollRounds = Number.parseInt(process.env.GOOGLE_MAPS_SCROLL_ROUNDS ?? "8", 10);

  logger.info("tier selected", { tierId, tierName });
  logger.info("country selected", { country: country.name });

  await collectLeadSet({
    queries: industries.map((industry) => ({ query: buildMapsQuery(industry, country.name), industry })),
    country,
    searchLimit,
    scrollRounds,
    tierId
  });
};

const collectSingleBusinessLead = async ({ businessName, countryName, industry = "manual_test", maxItems = 3 }) => {
  const country = {
    name: countryName,
    code: countryName.slice(0, 2).toUpperCase(),
    timezones: [inferTimezone(countryName, countryName)]
  };

  const leads = await collectLeadSet({
    queries: [{ query: buildBusinessQuery(businessName, countryName), industry, maxItems }],
    country,
    searchLimit: maxItems,
    scrollRounds: Number.parseInt(process.env.GOOGLE_MAPS_SCROLL_ROUNDS ?? "8", 10),
    tierId: 0
  });

  const normalizedBusinessName = businessName.trim().toLowerCase();
  return leads.find((lead) => lead.name.toLowerCase().includes(normalizedBusinessName)) ?? leads[0] ?? null;
};

export { buildBusinessQuery, buildMapsQuery, collectLeads, collectSingleBusinessLead };
