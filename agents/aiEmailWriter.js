import { logger } from "../utils/logger.js";

const buildPrompt = (lead) => {
  if (lead.hasWebsite === false) {
    return [
      "Write a personalized cold outreach email under 90 words.",
      "Tone: human, specific, non-spammy, concise.",
      `Business: ${lead.name}`,
      `Industry: ${lead.industry}`,
      `City: ${lead.city}`,
      "Context: business is listed on Google Maps but appears to have no website.",
      "Mention trust, conversions, and a simple website suggestion.",
      "End with a single question CTA."
    ].join("\n");
  }

  return [
    "Write a personalized cold outreach email under 90 words.",
    "Tone: human, specific, non-spammy, concise.",
    `Business: ${lead.name}`,
    `Industry: ${lead.industry}`,
    `City: ${lead.city}`,
    `Website performance score: ${lead.speedScore ?? "unknown"}`,
    "Context: website appears slow and mobile performance matters for conversions.",
    "Mention speed issue, conversion impact, and offer a free performance audit.",
    "End with a single question CTA."
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

const buildFallbackEmail = (lead) => {
  if (lead.hasWebsite === false) {
    return `Hi ${lead.name}, I found your business on Google Maps and noticed there doesn't seem to be a website yet. For local businesses in ${lead.city}, that often means fewer trust signals and missed enquiries. I help teams launch simple, fast sites that look credible and convert better. Would you be open to a quick idea for a lightweight website setup?`;
  }

  return `Hi ${lead.name}, I took a quick look at your website and it seems to load slower than ideal, especially for mobile visitors. That can quietly reduce enquiries and conversions for businesses in ${lead.city}. I can share a free performance audit with a few practical fixes to speed things up. Would that be useful?`;
};

const trimToNinetyWords = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, 90).join(" ");
};

const generateEmailBody = async (lead) => {
  const useOllama = process.env.OLLAMA_ENABLED === "true";

  try {
    const emailBody = useOllama ? trimToNinetyWords(await callOllama(buildPrompt(lead))) : trimToNinetyWords(buildFallbackEmail(lead));
    logger.info("email generated", { businessName: lead.name });
    return emailBody;
  } catch (error) {
    logger.warn("ollama generation failed, using fallback", {
      businessName: lead.name,
      error: error.message
    });
    return trimToNinetyWords(buildFallbackEmail(lead));
  }
};

export { buildFallbackEmail, buildPrompt, generateEmailBody };
