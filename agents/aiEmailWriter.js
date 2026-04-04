import { logger } from "../utils/logger.js";

const hashString = (value) => {
  return Array.from(String(value ?? "")).reduce((total, character) => {
    return (total * 31 + character.charCodeAt(0)) >>> 0;
  }, 7);
};

const normalizeIndustry = (industry) => {
  return String(industry ?? "business").replace(/\s+/g, " ").trim().toLowerCase();
};

const buildBusinessContext = (lead) => {
  return {
    businessName: String(lead.name ?? "there").trim(),
    city: String(lead.city ?? "your area").trim(),
    industry: normalizeIndustry(lead.industry),
    speedScore: lead.speedScore ?? null,
    homepageLoadTimeMs: lead.homepageLoadTimeMs ?? null
  };
};

const buildPrompt = (lead) => {
  const context = buildBusinessContext(lead);

  if (lead.hasWebsite === false) {
    return [
      "Write a cold outreach email under 85 words.",
      "Sound like a real person, not a marketer.",
      "Avoid hype, buzzwords, and salesy language.",
      "Use a simple opening that feels specifically written for this business.",
      `Business: ${context.businessName}`,
      `Industry: ${context.industry}`,
      `City: ${context.city}`,
      "Observation: the business appears on Google Maps but does not seem to have a website.",
      "Mention one practical business impact of missing a website for local customers.",
      "Offer one small helpful idea, not a big pitch.",
      "End with one short, low-pressure question.",
      "Do not use exclamation marks."
    ].join("\n");
  }

  return [
    "Write a cold outreach email under 85 words.",
    "Sound like a real person, not a marketer.",
    "Avoid hype, buzzwords, and spammy phrasing.",
    "Use a simple opening that feels specifically written for this business.",
    `Business: ${context.businessName}`,
    `Industry: ${context.industry}`,
    `City: ${context.city}`,
    `Website performance score: ${context.speedScore ?? "unknown"}`,
    `Homepage load time in ms: ${context.homepageLoadTimeMs ?? "unknown"}`,
    "Observation: the website feels slower than ideal, especially on mobile.",
    "Explain one practical effect on enquiries or conversion.",
    "Offer a free quick audit or a few specific fixes.",
    "End with one short, low-pressure question.",
    "Do not use exclamation marks."
  ].join("\n");
};

const callOllama = async (prompt) => {
  const response = await fetch(`${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? "llama3",
      prompt,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const data = await response.json();
  return String(data.response ?? "").trim();
};

const noWebsiteTemplates = [
  ({ businessName, city, industry }) => `Hi ${businessName}, I came across your ${industry} in ${city} and noticed I couldn't find a proper website for it. A lot of people check a business online before they call, so even a simple site can make things feel more established. If useful, I can send over a very lightweight idea for what that could look like. Would that help?`,
  ({ businessName, city }) => `Hi ${businessName}, I was looking at businesses in ${city} and noticed yours seems to rely mainly on Google Maps right now. That works to a point, but a simple website usually makes it easier for people to trust what they see and take the next step. I have a straightforward idea that could be quick to put together. Want me to send it?`,
  ({ businessName, industry }) => `Hi ${businessName}, I took a quick look at your online presence and it seems there may not be a website in place yet. For a local ${industry}, that can mean missed enquiries from people who want a bit more information before reaching out. I can sketch a simple, low-maintenance version that covers the essentials. Would you like me to share the outline?`
];

const slowWebsiteTemplates = [
  ({ businessName, city }) => `Hi ${businessName}, I took a quick look at your website and it felt slower than it should be, especially for mobile. For people finding a business in ${city}, even a few seconds of delay can quietly reduce calls and form enquiries. I can put together a short audit with the main fixes I'd look at first. Would you like me to send that over?`,
  ({ businessName, speedScore }) => `Hi ${businessName}, I was reviewing your site and noticed a few performance issues that are probably making it feel heavier than it needs to. When pages drag, some visitors leave before they get to the important bits. I can send a short note with the first improvements I'd make based on what I saw${speedScore ? `, especially with a current performance score around ${speedScore}` : ""}. Would that be useful?`,
  ({ businessName, city, homepageLoadTimeMs }) => `Hi ${businessName}, I checked your website briefly and the load time seemed a bit high${homepageLoadTimeMs ? `, roughly ${Math.round(homepageLoadTimeMs / 1000)} seconds on my end` : ""}. That can be enough to lose impatient mobile visitors in ${city}. I can share a few practical changes that usually make the biggest difference without a full rebuild. Want me to send them?`
];

const buildFallbackEmail = (lead) => {
  const context = buildBusinessContext(lead);
  const sourceTemplates = lead.hasWebsite === false ? noWebsiteTemplates : slowWebsiteTemplates;
  const variant = sourceTemplates[hashString(`${context.businessName}|${context.city}|${context.industry}|${context.speedScore ?? ""}`) % sourceTemplates.length];
  return variant(context);
};

const trimToWordLimit = (text, limit = 85) => {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, limit).join(" ");
};

const generateEmailBody = async (lead) => {
  const useOllama = process.env.OLLAMA_ENABLED === "true";

  try {
    const emailBody = useOllama ? trimToWordLimit(await callOllama(buildPrompt(lead))) : trimToWordLimit(buildFallbackEmail(lead));
    logger.info("email generated", { businessName: lead.name });
    return emailBody;
  } catch (error) {
    logger.warn("ollama generation failed, using fallback", {
      businessName: lead.name,
      error: error.message
    });
    return trimToWordLimit(buildFallbackEmail(lead));
  }
};

export { buildFallbackEmail, buildPrompt, generateEmailBody, hashString };
