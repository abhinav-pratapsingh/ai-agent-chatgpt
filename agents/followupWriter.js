const hashString = (value) => {
  return Array.from(String(value ?? "")).reduce((total, character) => {
    return (total * 31 + character.charCodeAt(0)) >>> 0;
  }, 11);
};

const buildFollowupPrompt = (lead) => {
  return [
    "Write a short follow-up email under 65 words.",
    "Sound human, calm, and low pressure.",
    "Do not sound like a sequence or marketing automation.",
    `Business: ${lead.name}`,
    `Industry: ${lead.industry}`,
    `City: ${lead.city}`,
    "Briefly reference the earlier note and restate the practical value.",
    "End with one short question.",
    "Do not use exclamation marks."
  ].join("\n");
};

const noWebsiteFollowups = [
  (lead) => `Hi ${lead.name}, just following up on my earlier note. Since many people will check Google Maps before calling, even a simple site can help answer basic questions and make the business feel more established. If useful, I can send a one-page outline tailored to ${lead.city}. Want me to?`,
  (lead) => `Hi ${lead.name}, I just wanted to circle back. I still think a lightweight website could make it easier for people to trust what they see and contact you without extra friction. If you'd like, I can send a simple structure that would work well for a business in ${lead.city}. Interested?`
];

const speedFollowups = [
  (lead) => `Hi ${lead.name}, just circling back in case my last note got buried. I still think a few speed fixes could make the site feel noticeably smoother, especially on mobile. If helpful, I can send a short audit with the first changes I'd make. Want me to share it?`,
  (lead) => `Hi ${lead.name}, following up once on the website note I sent earlier. Nothing dramatic, but I do think there are a few practical speed wins there that could help with conversions. If you'd like, I can send the quick version of what I spotted. Should I?`
];

const buildFallbackFollowup = (lead) => {
  const templates = lead.hasWebsite === false ? noWebsiteFollowups : speedFollowups;
  return templates[hashString(`${lead.name}|${lead.city}|${lead.industry}`) % templates.length](lead);
};

const trimToWordLimit = (text, limit = 65) => {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  return words.slice(0, limit).join(" ");
};

const generateFollowupBody = async (lead) => {
  if (process.env.OLLAMA_ENABLED !== "true") {
    return trimToWordLimit(buildFallbackFollowup(lead));
  }

  try {
    const response = await fetch(`${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "llama3",
        prompt: buildFollowupPrompt(lead),
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    const data = await response.json();
    return trimToWordLimit(String(data.response ?? "").trim());
  } catch (_error) {
    return trimToWordLimit(buildFallbackFollowup(lead));
  }
};

export { buildFallbackFollowup, buildFollowupPrompt, generateFollowupBody, hashString };
