import {
  buildActionPrompt,
  buildAnalysisPrompt,
  buildGradeAnswerPrompt,
  buildLessonScriptPrompt,
  buildPodcastScriptPrompt,
  buildStudyPlanPrompt,
  buildSubjectExamPrompt,
  buildSubjectQuestionsPrompt,
  buildTextExtractionPrompt,
  buildVideoRecommendationsPrompt,
} from './prompts.js';
import { getProvider } from './providers/index.js';
import { completeSubjectWithDemo, completeWithDemo } from './providers/demo.js';
import { gradeAgainstModel } from '../../../shared/answerGrading.js';
import {
  demoVideoRecommendations,
  fallbackVideoSearchQuery,
  normalizeVideoRecommendations,
  styleMatchReason,
} from '../videoRecommendations.js';
import { chunkText } from '../../../shared/textChunks.js';

// Scans for the first balanced top-level {...} object, skipping over quoted
// strings — unlike a greedy /\{[\s\S]*\}/ match, this can't overrun into
// trailing prose from a more preamble-prone provider (e.g. Claude) whose
// commentary after the JSON happens to contain brace characters.
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const parseJson = (text) => {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) throw Object.assign(new Error('Resposta da IA não estava em JSON.'), { code: 'AI_INVALID_RESPONSE' });
    try {
      return JSON.parse(extracted);
    } catch {
      throw Object.assign(new Error('Resposta da IA não estava em JSON.'), { code: 'AI_INVALID_RESPONSE' });
    }
  }
};

const asText = (value, fallback = '', max = 2400) => String(value ?? fallback).trim().slice(0, max);
const asList = (value, max = 5) => Array.isArray(value) ? value.map((item) => asText(item, '', 500)).filter(Boolean).slice(0, max) : [];

export function isDemoMode() {
  return String(process.env.JOVI_LENS_DEMO_MODE || '').toLowerCase() === 'true';
}

function normalizeAnalysis(result, meta) {
  return {
    text: asText(result?.text, '', 10000),
    language: asText(result?.language, 'auto', 12),
    title: asText(result?.title, 'Conteúdo identificado', 120),
    summary: asText(result?.summary, 'Conteúdo visual identificado para estudo.', 800),
    keyPoints: asList(result?.keyPoints),
    category: asText(result?.category, 'Estudos', 60),
    contentType: asText(result?.contentType, 'Conteúdo visual', 60),
    subject: asText(result?.subject, 'Estudos', 80),
    confidence: Number.isFinite(Number(result?.confidence)) ? Math.min(1, Math.max(0, Number(result.confidence))) : null,
    suggestedQuestions: asList(result?.suggestedQuestions, 4),
    learning: {
      understand: result?.learning?.understand || null,
      solve: result?.learning?.solve || null,
      practice: result?.learning?.practice || null,
      flashcards: Array.isArray(result?.learning?.flashcards) ? result.learning.flashcards.slice(0, 6) : [],
    },
    provider: meta.provider,
    model: meta.model,
    mode: meta.provider === 'demo' ? 'demo' : 'live',
  };
}

function normalizeTextExtraction(result, meta) {
  return {
    text: asText(result?.text, '', 10000),
    language: asText(result?.language, 'auto', 12),
    confidence: Number.isFinite(Number(result?.confidence)) ? Math.min(1, Math.max(0, Number(result.confidence))) : null,
    provider: meta.provider,
    model: meta.model,
    mode: meta.provider === 'demo' ? 'demo' : 'live',
  };
}

export async function runStudyAI({ action = 'analyze', question = '', context = null, imageDataUrl, credentials = null }) {
  if (isDemoMode()) {
    const demo = await completeWithDemo({ action, question, context });
    if (action === 'extract') return normalizeTextExtraction(demo.result, demo);
    return action === 'analyze' ? normalizeAnalysis(demo.result, demo) : { ...demo.result, provider: demo.provider, model: demo.model, mode: 'demo' };
  }

  const content = [{ type: 'text', text: action === 'analyze' ? buildAnalysisPrompt() : action === 'extract' ? buildTextExtractionPrompt() : buildActionPrompt({ action, question, context }) }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
  const provider = getProvider(imageDataUrl ? 'vision' : 'chat', { byok: credentials });
  // 'analyze'/'extract' transcribe + fully break down whatever's in the image
  // (verbatim text + the full learning object) — a dense photo (a handwritten
  // page of notes, say) can easily need more than the 1400-token default sized
  // for lighter follow-up actions, and a truncated response is invalid JSON,
  // not just short. Give vision calls a bigger budget and more time: MiniMax-Text-01
  // took ~29 s on a dense handwritten page (2026-10-22); 45 s + a 12 s repair
  // stays under the 60 s function limit.
  const completion = imageDataUrl
    ? await provider.complete({ messages: [{ role: 'user', content }], maxTokens: 3200, timeoutMs: 45000 })
    : await provider.complete({ messages: [{ role: 'user', content }] });
  const result = parseJson(completion.text);
  return action === 'analyze'
    ? normalizeAnalysis(result, completion)
    : action === 'extract'
      ? normalizeTextExtraction(result, completion)
    : { ...result, provider: completion.provider, model: completion.model, mode: 'live' };
}

// ---------------------------------------------------------------------------
// Subject-level generation (over ALL notes of a matéria).
// ---------------------------------------------------------------------------

const SUBJECT_ACTIONS = new Set(['questions', 'exam', 'plan', 'podcast-script', 'lesson-script', 'grade']);

function normalizeGrade(result, meta) {
  const score = clampInt(result?.score, 0, 10, 0);
  return {
    score,
    level: asText(result?.level, score >= 8 ? 'Resposta completa' : score >= 6 ? 'Boa base, faltam conceitos' : 'Precisa desenvolver', 60),
    feedback: asText(result?.feedback, '', 500),
    strengths: asList(result?.strengths, 3),
    missing: asList(result?.missing, 3),
    provider: meta.provider,
    model: meta.model,
    mode: meta.provider === 'demo' ? 'demo' : 'live',
  };
}

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

function normalizeSubject(action, result, subjectName, meta) {
  const subject = asText(result?.subject, subjectName, 80) || subjectName;
  const base = { subject, provider: meta.provider, model: meta.model, mode: meta.provider === 'demo' ? 'demo' : 'live' };

  if (action === 'questions') {
    const questions = (Array.isArray(result?.questions) ? result.questions : []).slice(0, 12).map((q) => ({
      question: asText(q?.question, '', 400),
      answer: asText(q?.answer, '', 600),
      topic: asText(q?.topic, 'Geral', 60),
      difficulty: ['fácil', 'média', 'difícil'].includes(String(q?.difficulty)) ? q.difficulty : 'média',
    })).filter((q) => q.question);
    return { ...base, questions };
  }

  if (action === 'exam') {
    const questions = (Array.isArray(result?.questions) ? result.questions : []).slice(0, 12).map((q) => {
      const rawOptions = asList(q?.options, 6);
      const rawAnswer = Number(q?.answerIndex);
      const validAnswer = Number.isInteger(rawAnswer) && rawAnswer >= 0 && rawAnswer < rawOptions.length;
      // Cap at 4 options but never drop the correct one: if it sits beyond the
      // window, swap it in and re-index (instead of silently marking a wrong one).
      let options = rawOptions.slice(0, 4);
      let answerIndex = validAnswer ? rawAnswer : -1;
      if (validAnswer && rawAnswer >= 4) {
        options = [...rawOptions.slice(0, 3), rawOptions[rawAnswer]];
        answerIndex = 3;
      }
      return {
        question: asText(q?.question, '', 400),
        options,
        answerIndex,
        explanation: asText(q?.explanation, '', 500),
        topic: asText(q?.topic, 'Geral', 60),
      };
    }).filter((q) => q.question && q.options.length >= 2 && q.answerIndex >= 0 && q.answerIndex < q.options.length);
    return { ...base, durationMinutes: clampInt(result?.durationMinutes, 3, 60, 10), questions };
  }

  if (action === 'plan') {
    const sessions = (Array.isArray(result?.sessions) ? result.sessions : []).slice(0, 8).map((s, index) => ({
      label: asText(s?.label, `Sessão ${index + 1}`, 40),
      focus: asText(s?.focus, 'Revisão', 120),
      durationMinutes: clampInt(s?.durationMinutes, 10, 180, 30),
      tasks: asList(s?.tasks, 6),
    })).filter((s) => s.focus);
    const spacedReview = (Array.isArray(result?.spacedReview) ? result.spacedReview : []).slice(0, 8).map((r) => ({
      topic: asText(r?.topic, '', 80),
      when: asText(r?.when, 'em 3 dias', 40),
    })).filter((r) => r.topic);
    const calendarEvent = result?.calendarEvent && typeof result.calendarEvent === 'object' ? {
      title: asText(result.calendarEvent.title, '', 160),
      startsAt: asText(result.calendarEvent.startsAt, '', 80),
      source: asText(result.calendarEvent.source, 'Google Agenda', 40),
      topics: asList(result.calendarEvent.topics, 8),
      strategy: asText(result.calendarEvent.strategy, '', 500),
    } : null;
    return { ...base, overview: asText(result?.overview, '', 400), sessions, spacedReview, ...(calendarEvent?.title ? { calendarEvent } : {}) };
  }

  if (action === 'podcast-script') {
    const segments = (Array.isArray(result?.segments) ? result.segments : []).slice(0, 24).map((seg) => ({
      speaker: ['A', 'B', 'narrator', 'coach', 'feedback'].includes(String(seg?.speaker)) ? seg.speaker : 'narrator',
      text: asText(seg?.text, '', 900),
    })).filter((seg) => seg.text);
    const interactions = (Array.isArray(result?.interactions) ? result.interactions : []).slice(0, 8).map((item, index) => {
      const options = (Array.isArray(item?.options) ? item.options : []).slice(0, 4).map((option, optionIndex) => ({
        id: asText(option?.id, `${index + 1}-${optionIndex + 1}`, 40),
        text: asText(option?.text, '', 300),
        correct: Boolean(option?.correct),
      })).filter((option) => option.text);
      return {
        id: asText(item?.id, `drive-${index + 1}`, 60),
        topic: asText(item?.topic, 'Revisão', 80),
        prompt: asText(item?.prompt, '', 400),
        options,
        feedbackCorrect: asText(item?.feedbackCorrect, 'Boa. Esse é o raciocínio principal.', 500),
        feedbackWrong: asText(item?.feedbackWrong, 'Quase. Volte ao conceito e compare com a alternativa correta.', 500),
      };
    }).filter((item) => item.prompt && item.options.length >= 2);
    const requestedFormat = ['dialogue', 'single', 'drive'].includes(String(meta.requestedFormat))
      ? meta.requestedFormat
      : ['dialogue', 'single', 'drive'].includes(String(result?.format)) ? result.format : 'dialogue';
    return {
      ...base,
      format: requestedFormat,
      title: asText(result?.title, `Podcast · ${subject}`, 120),
      durationMinutes: clampInt(result?.durationMinutes, 4, 45, Math.max(5, Math.round(segments.reduce((sum, seg) => sum + seg.text.length, 0) / 850))),
      takeaways: asList(result?.takeaways, 5),
      segments,
      interactions,
    };
  }

  // lesson-script
  const slides = (Array.isArray(result?.slides) ? result.slides : []).slice(0, 10).map((slide) => ({
    heading: asText(slide?.heading, '', 120),
    bullets: asList(slide?.bullets, 5),
    narration: asText(slide?.narration, '', 900),
  })).filter((slide) => slide.heading || slide.narration);
  return { ...base, title: asText(result?.title, `Aula · ${subject}`, 120), slides };
}

function buildSubjectPrompt(action, subject, preferences) {
  if (action === 'questions') return buildSubjectQuestionsPrompt(subject, preferences);
  if (action === 'exam') return buildSubjectExamPrompt(subject, preferences);
  if (action === 'plan') return buildStudyPlanPrompt(subject, preferences);
  if (action === 'podcast-script') return buildPodcastScriptPrompt(subject, { format: subject?.format, preferences });
  return buildLessonScriptPrompt(subject, preferences);
}

export async function runSubjectAI({ action = 'questions', subject = {}, preferences = {}, grading = null, credentials = null } = {}) {
  if (!SUBJECT_ACTIONS.has(action)) {
    throw Object.assign(new Error('Ação de matéria inválida.'), { code: 'AI_INVALID_RESPONSE' });
  }
  const subjectName = String(subject?.name || subject?.subject || 'Matéria').slice(0, 80);
  const normalizedPreferences = normalizeLearningPreferences(preferences);

  if (action === 'grade') {
    if (isDemoMode()) return normalizeGrade(gradeAgainstModel(grading || {}), { provider: 'demo', model: 'jovi-lens-demo' });
    const completion = await getProvider('chat', { byok: credentials }).complete({ messages: [{ role: 'user', content: buildGradeAnswerPrompt(subject, grading || {}, normalizedPreferences) }], maxTokens: 700, timeoutMs: 25000 });
    return normalizeGrade(parseJson(completion.text), completion);
  }

  if (isDemoMode()) {
    const demo = await completeSubjectWithDemo({ action, subject, preferences: normalizedPreferences });
    return normalizeSubject(action, demo.result, subjectName, { ...demo, requestedFormat: subject?.format });
  }

  // Longer budget than a single-image action: subject scripts are the biggest outputs.
  const completion = await getProvider('chat', { byok: credentials }).complete({ messages: [{ role: 'user', content: buildSubjectPrompt(action, subject, normalizedPreferences) }], maxTokens: 2600, timeoutMs: 45000 });
  const result = parseJson(completion.text);
  return normalizeSubject(action, result, subjectName, { ...completion, requestedFormat: subject?.format });
}

// Single allowlist for learning preferences — the handlers pass the raw
// client object straight through, so there is one place to extend.
export function normalizeLearningPreferences(input = {}) {
  const preferences = input && typeof input === 'object' ? input : {};
  const calendarEvents = Array.isArray(preferences.studyCalendar?.events) ? preferences.studyCalendar.events.slice(0, 5).map((event) => ({
    id: asText(event?.id, '', 120),
    type: event?.type === 'assignment' ? 'assignment' : 'exam',
    subject: asText(event?.subject, '', 80),
    title: asText(event?.title, '', 160),
    startsAt: asText(event?.startsAt, '', 80),
    topics: asList(event?.topics, 8),
  })).filter((event) => event.title && event.startsAt) : [];
  return {
    studyGoal: ['vestibular', 'enem', 'school_exam', 'general'].includes(preferences.studyGoal) ? preferences.studyGoal : 'vestibular',
    studyContext: ['classes', 'exam_season', 'catch_up', 'maintenance'].includes(preferences.studyContext) ? preferences.studyContext : 'classes',
    weeklyPace: ['light', 'regular', 'intense'].includes(preferences.weeklyPace) ? preferences.weeklyPace : 'regular',
    practiceMode: ['concept_first', 'questions_first', 'mixed'].includes(preferences.practiceMode) ? preferences.practiceMode : 'mixed',
    reviewMethod: ['spaced', 'retrieval', 'interleaved', 'flashcards'].includes(preferences.reviewMethod) ? preferences.reviewMethod : 'spaced',
    videoStyle: ['animated', 'balanced', 'calm', 'exam'].includes(preferences.videoStyle) ? preferences.videoStyle : 'balanced',
    duration: ['short', 'standard', 'long'].includes(preferences.duration) ? preferences.duration : 'standard',
    level: ['beginner', 'intermediate', 'advanced'].includes(preferences.level) ? preferences.level : 'intermediate',
    studyCalendar: calendarEvents.length ? {
      provider: preferences.studyCalendar?.provider === 'outlook' ? 'outlook' : 'google',
      syncedAt: asText(preferences.studyCalendar?.syncedAt, '', 80),
      events: calendarEvents,
    } : null,
  };
}

export async function runVideoRecommendations({ subject = {}, preferences = {}, credentials = null } = {}) {
  const normalizedPreferences = normalizeLearningPreferences(preferences);
  const fallbackQuery = fallbackVideoSearchQuery(subject, normalizedPreferences);

  if (isDemoMode()) {
    return demoVideoRecommendations(subject, normalizedPreferences);
  }

  const completion = await getProvider('chat', { byok: credentials }).complete({
    messages: [{ role: 'user', content: buildVideoRecommendationsPrompt(subject, normalizedPreferences) }],
    maxTokens: 1300,
    timeoutMs: 18000,
  });
  const plan = parseJson(completion.text);
  return normalizeVideoRecommendations(plan, subject, normalizedPreferences, {
    reason: styleMatchReason(normalizedPreferences),
    provider: completion.provider,
    model: completion.model,
    mode: 'live',
    fallbackQuery,
  });
}

// ---------------------------------------------------------------------------
// Audio services (live only; Demo Mode uses the browser's Web Speech).
// ---------------------------------------------------------------------------

const DEFAULT_TTS_CHUNK = 4000; // Azure/OpenAI /audio/speech caps input at 4096 chars.

export async function synthesizeSpeech({ text, voice = 'narrator', format = 'mp3', credentials = null }) {
  const provider = getProvider('tts', { byok: credentials });
  const chunks = chunkText(text, provider.ttsChunkLimit || DEFAULT_TTS_CHUNK);
  if (!chunks.length) throw Object.assign(new Error('Texto vazio para áudio.'), { code: 'AI_INVALID_RESPONSE' });
  const results = [];
  for (const chunk of chunks) {
    // Sequential on purpose: providers speak one chunk at a time.
    const audio = await provider.speak({ text: chunk, voice, format });
    results.push(audio.buffer.toString('base64'));
  }
  return { parts: results, mimeType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}`, voice };
}

export async function transcribeAudio({ buffer, mimeType, filename, credentials = null }) {
  return getProvider('stt', { byok: credentials }).transcribe({ buffer, mimeType, filename });
}
