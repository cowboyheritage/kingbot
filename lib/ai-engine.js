/**
 * Kingbot Custom AI Engine
 * Fully independent implementation heavily inspired by Grok Expert and Chaotic modes.
 * No external Grok API. Uses style-specific templates, intent detection, and personality modifiers.
 */

const EXPERT_STYLE = {
  prefix: ["Based on the available information: ", "To be precise: ", "Here's the accurate response: ", "Clear answer: "],
  suffix: [" Let me know if you need further clarification.", " This is the most direct explanation.", " Additional details available on request."],
  tone: "precise, helpful, structured, minimal flair"
};

const CHAOTIC_STYLE = {
  prefix: ["Alright, buckle up — ", "Hot take time: ", "Chat, listen because this is about to get interesting: ", "Not gonna sugarcoat it: "],
  suffix: [" Fight me.", " You're welcome for the chaos.", " This is why we can't have nice things.", " Don't say I didn't warn you."],
  tone: "irreverent, energetic, unpredictable, entertaining"
};

function getPersonalityPrompt(mode) {
  const style = mode === 'chaotic' ? CHAOTIC_STYLE : EXPERT_STYLE;
  return `You are ${mode === 'chaotic' ? 'an unhinged but sharp' : 'a precise and helpful'} streaming chat bot. Tone: ${style.tone}. Respond in character.`;
}

function generateResponse(message = '', mode = 'expert', botName = 'Kingbot') {
  const style = mode === 'chaotic' ? CHAOTIC_STYLE : EXPERT_STYLE;
  const lower = (message || '').toLowerCase();
  let core = '';

  if (/\b(hi|hello|hey|yo)\b/.test(lower)) {
    core = mode === 'chaotic' ? `${botName} just entered the chat. What's the move?` : `Hello. ${botName} is online and ready.`;
  } else if (lower.includes('tts') || lower.includes('voice')) {
    core = mode === 'chaotic' ? 'TTS is armed and ready to cause problems. Pick a voice and go.' : 'TTS is active. Character limits and cooldowns are controlled by the streamer.';
  } else if (lower.includes('sub') || lower.includes('tier')) {
    core = mode === 'chaotic' ? 'Higher tiers unlock more chaos. Free tier is still spicy.' : 'Subscription tiers increase TTS character limits and unlock custom voices.';
  } else if (lower.includes('clip')) {
    core = mode === 'chaotic' ? 'Clip it. That moment was unhinged.' : 'Clip creation is available via command.';
  } else if (message.length > 10) {
    core = mode === 'chaotic'
      ? `Interesting take: "${message.slice(0, 60)}${message.length > 60 ? '...' : ''}". Chat, what do we think?`
      : `Regarding "${message.slice(0, 80)}": I can assist with stream, TTS, or chat questions.`;
  } else {
    core = mode === 'chaotic' ? 'Say something worth responding to.' : 'How can I assist?';
  }

  const prefix = style.prefix[Math.floor(Math.random() * style.prefix.length)];
  const suffix = style.suffix[Math.floor(Math.random() * style.suffix.length)];
  return prefix + core + suffix;
}

function generateStreamComment(eventType = 'hype', opts = {}) {
  const mode = opts.mode || 'chaotic';
  const freq = opts.frequency || 30;
  const templates = {
    follow: mode === 'chaotic' ? 'New follower. Welcome to the chaos zone.' : 'New follower. Thank you.',
    sub: mode === 'chaotic' ? 'Sub just hit. Lore updated.' : 'New subscriber. Appreciated.',
    tip: mode === 'chaotic' ? 'Tip received. Volume just went up.' : 'Donation received. Thank you.',
    silence: mode === 'chaotic' ? 'Chat is too quiet. Someone say something unhinged.' : 'Chat is currently quiet.',
    hype: mode === 'chaotic' ? 'Chat is moving. This is the good part.' : 'Engagement is rising.',
    raid: mode === 'chaotic' ? 'Raid incoming. Brace for impact.' : 'Incoming raid.'
  };
  const base = templates[eventType] || (mode === 'chaotic' ? 'Something happened. React.' : 'Event detected.');
  return freq > 50 ? base + ' (high frequency mode)' : base;
}

module.exports = { generateResponse, generateStreamComment, getPersonalityPrompt };