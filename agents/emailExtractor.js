import puppeteer from "puppeteer";
import { findLeads, updateLead } from "../database/mongo.js";
import { logger } from "../utils/logger.js";

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const extractEmailsFromText = (text) => {
  return Array.from(new Set((text.match(emailRegex) ?? []).map((email) => email.toLowerCase())));
};

const createCandidateUrls = (website) => {
  if (!website) {
    return [];
  }

  const normalizedWebsite = website.endsWith("/") ? website.slice(0, -1) : website;
  return [
    normalizedWebsite,
    `${normalizedWebsite}/contact`,
    `${normalizedWebsite}/contact-us`,
    `${normalizedWebsite}/about`,
    `${normalizedWebsite}/about-us`,
    `${normalizedWebsite}/locations`,
    `${normalizedWebsite}/our-team`
  ];
};

const extractEmailsFromPage = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const text = await page.evaluate(() => {
    const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((link) => link.getAttribute("href")?.replace(/^mailto:/i, "") ?? "");
    const linkTexts = Array.from(document.querySelectorAll("a"))
      .map((link) => `${link.textContent ?? ""}\n${link.getAttribute("href") ?? ""}`)
      .join("\n");
    return `${document.body?.innerText ?? ""}\n${linkTexts}\n${mailtoLinks.join("\n")}`;
  });
  return extractEmailsFromText(text);
};

const extractCandidateLinks = async (page, baseUrl) => {
  return page.evaluate((origin) => {
    const keywords = ["contact", "about", "team", "location", "clinic", "book", "appointment"];
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((link) => link.getAttribute("href") ?? "")
      .filter(Boolean)
      .map((href) => {
        try {
          return new URL(href, origin).toString();
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((href) => href.startsWith(origin))
      .filter((href) => keywords.some((keyword) => href.toLowerCase().includes(keyword)));

    return Array.from(new Set(links)).slice(0, 8);
  }, new URL(baseUrl).origin);
};

const pickBestEmail = (emails, website) => {
  if (emails.length === 0) {
    return null;
  }

  const hostname = website ? new URL(website).hostname.replace(/^www\./i, "").toLowerCase() : "";
  const rankedEmails = [...emails].sort((left, right) => {
    const leftScore = Number(left.endsWith(`@${hostname}`)) * 10 + Number(!/info|hello|admin|office/i.test(left));
    const rightScore = Number(right.endsWith(`@${hostname}`)) * 10 + Number(!/info|hello|admin|office/i.test(right));
    return rightScore - leftScore;
  });

  return rankedEmails[0];
};

const buildSearchQueries = (lead) => {
  return [
    `site:${new URL(lead.website ?? "https://example.com").hostname.replace(/^www\./i, "")} email`,
    `"${lead.name}" "${lead.city}" "${lead.country}" email`,
    `"${lead.name}" contact email "${lead.city}"`,
    `site:facebook.com "${lead.name}" "${lead.city}" email`
  ];
};

const searchForBusinessEmail = async (page, lead) => {
  for (const query of buildSearchQueries(lead)) {
    try {
      await page.goto(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });

      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const emails = extractEmailsFromText(text).filter((email) => !email.endsWith("@example.com"));

      if (emails.length > 0) {
        return pickBestEmail(emails, lead.website);
      }
    } catch (error) {
      logger.debug("search-based email extraction failed", { businessName: lead.name, query, error: error.message });
    }
  }

  return null;
};

const extractEmailForLead = async (lead) => {
  const browser = await puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(process.env.USER_AGENT ?? "Mozilla/5.0");

    let discoveredEmail = null;
    const visitedUrls = new Set();

    for (const url of createCandidateUrls(lead.website)) {
      if (visitedUrls.has(url)) {
        continue;
      }

      visitedUrls.add(url);

      try {
        const emails = await extractEmailsFromPage(page, url);

        if (emails.length > 0) {
          discoveredEmail = pickBestEmail(emails, lead.website);
          break;
        }

        const nestedCandidateUrls = await extractCandidateLinks(page, url);

        for (const nestedUrl of nestedCandidateUrls) {
          if (visitedUrls.has(nestedUrl)) {
            continue;
          }

          visitedUrls.add(nestedUrl);
          const nestedEmails = await extractEmailsFromPage(page, nestedUrl).catch(() => []);

          if (nestedEmails.length > 0) {
            discoveredEmail = pickBestEmail(nestedEmails, lead.website);
            break;
          }
        }

        if (discoveredEmail) {
          break;
        }
      } catch (error) {
        logger.debug("email extraction page failed", { url, error: error.message });
      }
    }

    if (!discoveredEmail) {
      discoveredEmail = await searchForBusinessEmail(page, lead);
    }

    await page.close();

    if (discoveredEmail && lead._id) {
      await updateLead(
        { _id: lead._id },
        {
          $set: {
            email: discoveredEmail,
            updatedAt: new Date()
          }
        }
      );
    }

    if (discoveredEmail) {
      logger.info("email extracted", { businessName: lead.name, email: discoveredEmail });
    }

    return discoveredEmail;
  } finally {
    await browser.close();
  }
};

const extractEmails = async () => {
  const leads = await findLeads({
    email: { $in: [null, ""] }
  });

  if (leads.length === 0) {
    logger.info("email extraction skipped", { reason: "no leads pending" });
    return;
  }

  for (const lead of leads) {
    await extractEmailForLead(lead);
  }
};

export { createCandidateUrls, extractEmailForLead, extractEmails, extractEmailsFromText, searchForBusinessEmail };
