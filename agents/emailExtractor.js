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
  return [normalizedWebsite, `${normalizedWebsite}/contact`, `${normalizedWebsite}/about`];
};

const extractEmails = async () => {
  const leads = await findLeads({
    hasWebsite: true,
    email: { $in: [null, ""] }
  });

  if (leads.length === 0) {
    logger.info("email extraction skipped", { reason: "no leads pending" });
    return;
  }

  const browser = await puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    for (const lead of leads) {
      const page = await browser.newPage();
      await page.setUserAgent(process.env.USER_AGENT ?? "Mozilla/5.0");

      let discoveredEmail = null;

      for (const url of createCandidateUrls(lead.website)) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          const text = await page.evaluate(() => document.body?.innerText ?? "");
          const emails = extractEmailsFromText(text);

          if (emails.length > 0) {
            [discoveredEmail] = emails;
            break;
          }
        } catch (error) {
          logger.debug("email extraction page failed", { url, error: error.message });
        }
      }

      await page.close();

      if (discoveredEmail) {
        await updateLead(
          { _id: lead._id },
          {
            $set: {
              email: discoveredEmail,
              updatedAt: new Date()
            }
          }
        );
        logger.info("email extracted", { businessName: lead.name, email: discoveredEmail });
      }
    }
  } finally {
    await browser.close();
  }
};

export { createCandidateUrls, extractEmails, extractEmailsFromText };
