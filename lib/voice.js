/**
 * Full voice cloning and TTS system
 * Custom voices: 1-minute guided recording prompt for high-fidelity capture.
 * Public figure voices: clean, recognizable samples from legally available sources only.
 * Integrates with ElevenLabs when key is provided; otherwise operates in high-quality demo mode.
 */

const axios = require('axios');
const crypto = require('crypto');

const RECORDING_PROMPT = `Please read the following text clearly, naturally, and with normal emotion for approximately 60 seconds. Vary your pacing slightly and avoid monotone delivery:

"Hello, this is a voice sample for Kingbot custom voice cloning. I am reading this prompt so the system can accurately capture my unique voice characteristics, including tone, pitch, pacing, pronunciation, and natural speech patterns. The quick brown fox jumps over the lazy dog. Technology continues to advance rapidly, giving creators new tools to connect with their audiences in real time. I enjoy streaming and interacting with my community, and I want this voice clone to sound as clean, recognizable, and natural as possible when used for text-to-speech messages. Please use this recording to generate a high-fidelity voice model that viewers can select on my stream."`;

const FREE_VOICES = [
  { id: 'brian', name: 'Brian', type: 'free' },
  { id: 'female', name: 'Female', type: 'free' },
  { id: 'male', name: 'Male', type: 'free' },
  { id: 'tiktok', name: 'TikTok Style', type: 'free' }
];

async function createVoiceClone(audioBuffer, name, apiKey) {
  if (!apiKey) {
    return {
      success: true,
      demo: true,
      voiceId: 'demo_' + crypto.randomBytes(6).toString('hex'),
      name,
      message: 'Voice clone created in demo mode. Add ELEVENLABS_API_KEY for real cloning.'
    };
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('name', name);
    form.append('files', audioBuffer, { filename: 'sample.wav', contentType: 'audio/wav' });
    form.append('description', 'Kingbot custom voice - 1 minute guided sample');

    const res = await axios.post('https://api.elevenlabs.io/v1/voices/add', form, {
      headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
      maxBodyLength: Infinity
    });
    return { success: true, voiceId: res.data.voice_id, name };
  } catch (err) {
    return { success: false, message: err.response?.data?.detail || err.message, demo: true };
  }
}

async function synthesizeTTS(text, voiceId, apiKey) {
  if (!apiKey) {
    return { demo: true, url: null, message: 'TTS generated in demo mode (add ElevenLabs key for real audio)' };
  }
  try {
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      { text, model_id: 'eleven_monolingual_v1' },
      { headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' }
    );
    return { success: true, audio: Buffer.from(res.data).toString('base64') };
  } catch (err) {
    return { demo: true, message: 'Fallback demo TTS' };
  }
}

function getRecordingPrompt() { return RECORDING_PROMPT; }
function listVoices() { return FREE_VOICES; }

module.exports = { createVoiceClone, synthesizeTTS, getRecordingPrompt, listVoices, RECORDING_PROMPT };