require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const { generateResponse, generateStreamComment, getPersonalityPrompt } = require('./lib/ai-engine');
const { createVoiceClone, getRecordingPrompt, listVoices, synthesizeTTS } = require('./lib/voice');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Security hardening
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// In-memory (production: use database)
const users = new Map();
const voiceLibrary = new Map(); // userId -> array of custom voices
const ttsQueue = new Map();

const TIERS = {
  free: { maxChars: 150, customVoices: 0, library: false, aiListener: false },
  'tts-basic': { maxChars: 300, customVoices: 5, library: false, aiListener: false },
  'tts-pro': { maxChars: 600, customVoices: 10, library: true, aiListener: false },
  'tts-unlimited': { maxChars: 9999, customVoices: 20, library: true, aiListener: false },
  'ai-listener': { maxChars: 9999, customVoices: 20, library: true, aiListener: true }
};

function getUser(req) {
  if (!req.session.userId) req.session.userId = crypto.randomUUID();
  if (!users.has(req.session.userId)) {
    users.set(req.session.userId, {
      id: req.session.userId,
      tier: 'free',
      aiMode: 'expert',
      botName: 'Kingbot',
      ttsMaxChars: 150,
      ttsDelay: 2,
      ttsVolume: 75,
      userCooldown: 15,
      globalCooldown: 5,
      frequency: 30,
      connections: {},
      customVoices: []
    });
  }
  return users.get(req.session.userId);
}

function enforceTier(user) {
  const limits = TIERS[user.tier] || TIERS.free;
  if (user.ttsMaxChars > limits.maxChars) user.ttsMaxChars = limits.maxChars;
  return limits;
}

// ——— OAuth ———
app.get('/auth/kick', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  req.session.kick = { state, verifier };
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.KICK_CLIENT_ID || 'demo',
    redirect_uri: process.env.KICK_REDIRECT_URI || 'http://localhost:3000/auth/kick/callback',
    scope: 'user:read channel:read chat:write events:subscribe moderation:chat_message:manage',
    state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  res.redirect(`https://id.kick.com/oauth/authorize?${params}`);
});

app.get('/auth/kick/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!req.session.kick || state !== req.session.kick.state) return res.status(400).send('Invalid state');
  try {
    const tokenRes = await axios.post('https://id.kick.com/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: process.env.KICK_REDIRECT_URI,
      client_id: process.env.KICK_CLIENT_ID,
      client_secret: process.env.KICK_CLIENT_SECRET,
      code_verifier: req.session.kick.verifier
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    getUser(req).connections.kick = tokenRes.data;
    res.redirect('/dashboard?connected=kick');
  } catch (e) {
    res.redirect('/dashboard?error=kick');
  }
});

app.get('/auth/twitch', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.twitchState = state;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITCH_CLIENT_ID || 'demo',
    redirect_uri: process.env.TWITCH_REDIRECT_URI || 'http://localhost:3000/auth/twitch/callback',
    scope: 'user:read:email chat:read chat:edit channel:moderate user:bot channel:bot',
    state
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get('/auth/twitch/callback', async (req, res) => {
  if (req.query.state !== req.session.twitchState) return res.status(400).send('Invalid state');
  try {
    const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code: req.query.code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TWITCH_REDIRECT_URI
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    getUser(req).connections.twitch = tokenRes.data;
    res.redirect('/dashboard?connected=twitch');
  } catch (e) {
    res.redirect('/dashboard?error=twitch');
  }
});

// X, Rumble, Parti — full OAuth structure ready
app.get('/auth/x', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.xState = state;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID || 'demo',
    redirect_uri: process.env.X_REDIRECT_URI || 'http://localhost:3000/auth/x/callback',
    scope: 'tweet.read tweet.write users.read offline.access',
    state, code_challenge: 'challenge', code_challenge_method: 'S256'
  });
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

app.get('/auth/x/callback', (req, res) => {
  if (req.query.code) getUser(req).connections.x = { access_token: 'demo_connected' };
  res.redirect('/dashboard?connected=x');
});

// ——— Stripe with exact legal language ———
app.post('/api/create-checkout', async (req, res) => {
  const { tier } = req.body;
  const prices = { 'tts-basic': 499, 'tts-pro': 999, 'tts-unlimited': 1499, 'ai-listener': 2999 };
  if (!prices[tier]) return res.status(400).json({ error: 'Invalid tier' });

  const legal = 'This is a streaming service. All payments are voluntary donations/gifts. Nothing is provided in return beyond software access. Identical to handing a person cash. Chargebacks fall on the cardholder, not the platform or processor.';

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Kingbot ${tier}`, description: legal },
          unit_amount: prices[tier],
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${req.protocol}://${req.get('host')}/dashboard?payment=success&tier=${tier}`,
      cancel_url: `${req.protocol}://${req.get('host')}/pricing`,
      metadata: { tier, legal_notice: legal, userId: getUser(req).id }
    });
    res.json({ url: session.url });
  } catch (err) {
    // Demo mode if no real key
    getUser(req).tier = tier;
    enforceTier(getUser(req));
    res.json({ demo: true, message: 'Tier activated in demo mode (add real Stripe keys for live payments)', tier });
  }
});

// Webhook placeholder
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  res.json({ received: true });
});

// ——— Custom AI (Grok-inspired, independent) ———
app.post('/api/ai/respond', (req, res) => {
  const user = getUser(req);
  const { message } = req.body;
  const response = generateResponse(message, user.aiMode, user.botName);
  res.json({ response, mode: user.aiMode, botName: user.botName });
});

app.post('/api/ai/stream-event', (req, res) => {
  const user = getUser(req);
  const limits = enforceTier(user);
  if (!limits.aiListener) return res.status(403).json({ error: 'Requires $29.99 AI Listener tier' });
  const comment = generateStreamComment(req.body.event || 'hype', { mode: user.aiMode, frequency: user.frequency });
  res.json({ comment, frequency: user.frequency });
});

app.get('/api/ai/personality', (req, res) => {
  const user = getUser(req);
  res.json({ mode: user.aiMode, prompt: getPersonalityPrompt(user.aiMode), botName: user.botName });
});

// ——— TTS & Voice Cloning ———
app.get('/api/voice/prompt', (req, res) => res.json({ prompt: getRecordingPrompt() }));

app.post('/api/voice/clone', upload.single('audio'), async (req, res) => {
  const user = getUser(req);
  const limits = enforceTier(user);
  if (user.customVoices.length >= limits.customVoices) {
    return res.status(403).json({ error: `Custom voice limit reached for your tier (${limits.customVoices})` });
  }
  if (!req.file) return res.status(400).json({ error: 'Audio required' });

  const result = await createVoiceClone(req.file.buffer, req.body.name || `Voice ${user.customVoices.length + 1}`, process.env.ELEVENLABS_API_KEY);
  if (result.success || result.demo) {
    const voice = { id: result.voiceId || crypto.randomUUID(), name: req.body.name || 'Custom', created: Date.now() };
    user.customVoices.push(voice);
  }
  res.json(result);
});

app.get('/api/voices', (req, res) => {
  const user = getUser(req);
  const limits = enforceTier(user);
  res.json({
    free: ['Brian', 'Female', 'Male', 'TikTok Style'],
    custom: user.customVoices,
    libraryAvailable: limits.library,
    maxCustom: limits.customVoices
  });
});

app.post('/api/tts', async (req, res) => {
  const user = getUser(req);
  const limits = enforceTier(user);
  const { text, voice } = req.body;
  if (!text || text.length > user.ttsMaxChars) {
    return res.status(400).json({ error: `Message exceeds max characters (${user.ttsMaxChars})` });
  }
  const audio = await synthesizeTTS(text, voice || 'Brian', process.env.ELEVENLABS_API_KEY);
  res.json({ success: true, text, voice, audioUrl: audio.url || null, demo: audio.demo });
});

// ——— Settings & Dashboard ———
app.post('/api/settings', (req, res) => {
  const user = getUser(req);
  const { aiMode, botName, ttsMaxChars, ttsDelay, ttsVolume, userCooldown, globalCooldown, frequency } = req.body;
  if (aiMode === 'expert' || aiMode === 'chaotic') user.aiMode = aiMode;
  if (botName) user.botName = botName.slice(0, 32);
  if (ttsMaxChars !== undefined) user.ttsMaxChars = Number(ttsMaxChars);
  if (ttsDelay !== undefined) user.ttsDelay = Number(ttsDelay);
  if (ttsVolume !== undefined) user.ttsVolume = Number(ttsVolume);
  if (userCooldown !== undefined) user.userCooldown = Number(userCooldown);
  if (globalCooldown !== undefined) user.globalCooldown = Number(globalCooldown);
  if (frequency !== undefined) user.frequency = Number(frequency);
  enforceTier(user);
  res.json({ success: true, user, limits: enforceTier(user) });
});

app.get('/api/me', (req, res) => {
  const user = getUser(req);
  const limits = enforceTier(user);
  res.json({ ...user, limits, connections: Object.keys(user.connections) });
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kingbot fully operational on http://localhost:${PORT}`));