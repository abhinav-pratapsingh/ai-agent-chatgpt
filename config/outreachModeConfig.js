const supportedOutreachModes = ["slow_website", "no_website", "combined"];
const OUTREACH_MODE = process.env.OUTREACH_MODE ?? "combined";

const getOutreachMode = () => {
  return supportedOutreachModes.includes(OUTREACH_MODE) ? OUTREACH_MODE : "combined";
};

const shouldTargetLead = ({ hasWebsite, speedScore }) => {
  const mode = getOutreachMode();
  const scoreValue = Number.isFinite(speedScore) ? speedScore : 100;

  if (mode === "slow_website") {
    return hasWebsite === true && scoreValue < 60;
  }

  if (mode === "no_website") {
    return hasWebsite === false;
  }

  return hasWebsite === false || scoreValue < 60;
};

export { OUTREACH_MODE, getOutreachMode, shouldTargetLead, supportedOutreachModes };
