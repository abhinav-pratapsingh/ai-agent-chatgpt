const buildFollowupPrompt = (lead) => {
  return [
    "Write a short follow-up email under 75 words.",
    "Tone: polite, human, low pressure.",
    `Business: ${lead.name}`,
    `Industry: ${lead.industry}`,
    `City: ${lead.city}`,
    "Reference the earlier note and restate the value briefly.",
    "End with one simple CTA question."
  ].join("\n");
};

const buildFallbackFollowup = (lead) => {
  if (lead.hasWebsite === false) {
    return `Hi ${lead.name}, just following up on my earlier note. Since many customers check Google Maps before calling, even a simple website can make the business feel more established and help convert more visits into enquiries. If helpful, I can send over a very lightweight website idea tailored to ${lead.city}. Interested?`;
  }

  return `Hi ${lead.name}, just circling back in case my earlier note got buried. I still think a few speed improvements could make your website feel much smoother for mobile visitors and help convert more traffic. If you'd like, I can send a free quick audit with the highest-impact fixes first. Want me to share it?`;
};

const generateFollowupBody = async (lead) => {
  if (process.env.OLLAMA_ENABLED !== "true") {
    return buildFallbackFollowup(lead);
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
    return String(data.response ?? "").trim();
  } catch (_error) {
    return buildFallbackFollowup(lead);
  }
};

export { buildFallbackFollowup, buildFollowupPrompt, generateFollowupBody };
