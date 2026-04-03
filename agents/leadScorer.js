import { isAllowedCountry } from "../config/countryConfig.js";
import { shouldTargetLead } from "../config/outreachModeConfig.js";
import { findLeads, updateLead } from "../database/mongo.js";
import { logger } from "../utils/logger.js";

const calculateLeadScore = (lead) => {
  let score = 0;
  const loadTimeThreshold = Number.parseInt(process.env.LOAD_TIME_THRESHOLD_MS ?? "4000", 10);

  if (lead.hasWebsite === false) {
    score += 2;
  }

  if (lead.slowWebsite === true) {
    score += 1;
  }

  if (lead.email) {
    score += 1;
  }

  if (isAllowedCountry(lead.country)) {
    score += 1;
  }

  if ((lead.homepageLoadTimeMs ?? 0) > loadTimeThreshold) {
    score += 1;
  }

  return score;
};

const scoreLeads = async () => {
  const minScore = Number.parseInt(process.env.MIN_LEAD_SCORE ?? "2", 10);
  const leads = await findLeads({});

  for (const lead of leads) {
    const score = calculateLeadScore(lead);
    const isTarget = shouldTargetLead(lead) && score >= minScore;

    await updateLead(
      { _id: lead._id },
      {
        $set: {
          score,
          isTarget,
          updatedAt: new Date()
        }
      }
    );

    logger.info("lead scored", {
      businessName: lead.name,
      score,
      isTarget
    });
  }
};

export { calculateLeadScore, scoreLeads };
