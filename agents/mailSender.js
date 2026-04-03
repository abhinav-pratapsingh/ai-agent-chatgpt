import nodemailer from "nodemailer";
import { getCountryTimezone } from "../config/countryConfig.js";
import { getSmtpDelayWindow, getSmtpProviderConfig, getSmtpProviderName } from "../config/smtpConfig.js";
import { findLeads, incrementEmailStats, resetEmailStatsIfNeeded, updateLead } from "../database/mongo.js";
import { randomDelay } from "../utils/delay.js";
import { logger } from "../utils/logger.js";
import { generateEmailBody } from "./aiEmailWriter.js";
import { generateFollowupBody } from "./followupWriter.js";
import { getSubjectLine } from "./subjectGenerator.js";

const isWithinBusinessHours = (timezone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false
  });
  const hour = Number.parseInt(formatter.format(new Date()), 10);
  return hour >= 9 && hour < 18;
};

const createTransporter = () => {
  const provider = getSmtpProviderConfig();
  return nodemailer.createTransport({
    host: provider.host,
    port: provider.port,
    secure: provider.secure,
    auth: provider.auth
  });
};

const canSendMoreEmails = async () => {
  const provider = getSmtpProviderConfig();
  const stats = await resetEmailStatsIfNeeded(provider.name);
  return stats.emailsSentToday < provider.dailyLimit && stats.emailsSentThisHour < provider.hourlyLimit;
};

const getEligibleLeadBatch = async () => {
  return findLeads({
    contacted: false,
    isTarget: true,
    email: { $nin: [null, ""] }
  }, {
    sort: { score: -1, updatedAt: -1 },
    limit: Number.parseInt(process.env.LEADS_PER_RUN ?? "30", 10)
  });
};

const sendOutreachEmails = async () => {
  const transporter = createTransporter();
  const providerName = getSmtpProviderName();
  const { minMs, maxMs } = getSmtpDelayWindow();
  const leads = await getEligibleLeadBatch();

  logger.info("mode selected", { providerName });

  for (const lead of leads) {
    const timezone = lead.timezone ?? getCountryTimezone(lead.country);

    if (!isWithinBusinessHours(timezone)) {
      logger.info("skipping lead outside send window", { businessName: lead.name, timezone });
      continue;
    }

    if (!(await canSendMoreEmails())) {
      logger.warn("sending stopped because provider limit reached", { providerName });
      break;
    }

    const subject = getSubjectLine(lead._id?.toString()?.length ?? Date.now());
    const emailBody = await generateEmailBody(lead);
    const recipient = process.env.TEST_MODE === "true" ? process.env.TEST_RECIPIENT : lead.email;

    if (!recipient) {
      logger.warn("skipping lead because recipient missing", { businessName: lead.name });
      continue;
    }

    await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME ?? "AI Outreach Agent"}" <${process.env.MAIL_FROM_EMAIL ?? process.env.GMAIL_USER}>`,
      to: recipient,
      replyTo: process.env.REPLY_TO_EMAIL || process.env.MAIL_FROM_EMAIL || process.env.GMAIL_USER,
      subject,
      text: emailBody
    });

    await updateLead(
      { _id: lead._id },
      {
        $set: {
          contacted: true,
          contactedDate: new Date(),
          emailBody,
          subjectLine: subject,
          nextFollowupAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          updatedAt: new Date()
        }
      }
    );

    await incrementEmailStats(providerName);
    logger.info("email sent", { businessName: lead.name, recipient, providerName });
    await randomDelay(minMs, maxMs);
  }
};

const sendFollowupEmails = async () => {
  const transporter = createTransporter();
  const providerName = getSmtpProviderName();
  const { minMs, maxMs } = getSmtpDelayWindow();
  const leads = await findLeads({
    contacted: true,
    followupSent: false,
    nextFollowupAt: { $lte: new Date() },
    email: { $nin: [null, ""] }
  }, {
    sort: { nextFollowupAt: 1 },
    limit: 20
  });

  for (const lead of leads) {
    const timezone = lead.timezone ?? getCountryTimezone(lead.country);

    if (!isWithinBusinessHours(timezone)) {
      continue;
    }

    if (!(await canSendMoreEmails())) {
      logger.warn("follow-up stopped because provider limit reached", { providerName });
      break;
    }

    const followupBody = await generateFollowupBody(lead);
    const recipient = process.env.TEST_MODE === "true" ? process.env.TEST_RECIPIENT : lead.email;

    if (!recipient) {
      continue;
    }

    await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME ?? "AI Outreach Agent"}" <${process.env.MAIL_FROM_EMAIL ?? process.env.GMAIL_USER}>`,
      to: recipient,
      replyTo: process.env.REPLY_TO_EMAIL || process.env.MAIL_FROM_EMAIL || process.env.GMAIL_USER,
      subject: `Following up: ${lead.subjectLine ?? getSubjectLine(Date.now())}`,
      text: followupBody
    });

    await updateLead(
      { _id: lead._id },
      {
        $set: {
          followupSent: true,
          followupBody,
          updatedAt: new Date()
        }
      }
    );

    await incrementEmailStats(providerName);
    logger.info("follow-up email sent", { businessName: lead.name, recipient, providerName });
    await randomDelay(minMs, maxMs);
  }
};

export { canSendMoreEmails, createTransporter, sendFollowupEmails, sendOutreachEmails };
