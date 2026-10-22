import { runSubjectAI } from './_lib/ai/service.js';
import { defineRoute } from './_lib/guard.js';

export const config = { api: { bodyParser: false } };

const VALID_ACTIONS = new Set(['questions', 'exam', 'plan', 'podcast-script', 'lesson-script', 'grade']);
const MAX_NOTES = 40;

function safeInput(body) {
  const action = VALID_ACTIONS.has(body?.action) ? body.action : 'questions';
  const subject = body?.subject && typeof body.subject === 'object' ? body.subject : null;
  if (!subject) return { error: { status: 400, code: 'INVALID_INPUT', message: 'Contexto da matéria ausente.' } };

  const name = typeof subject.name === 'string' ? subject.name.trim().slice(0, 80) : (typeof subject.subject === 'string' ? subject.subject.trim().slice(0, 80) : '');
  const rawNotes = Array.isArray(subject.notes) ? subject.notes.slice(0, MAX_NOTES) : [];
  const notes = rawNotes.map((note) => ({
    title: typeof note?.title === 'string' ? note.title.slice(0, 160) : '',
    summary: typeof note?.summary === 'string' ? note.summary.slice(0, 900) : '',
    text: typeof note?.text === 'string' ? note.text.slice(0, 1200) : '',
    keyPoints: Array.isArray(note?.keyPoints) ? note.keyPoints.filter((p) => typeof p === 'string').slice(0, 6).map((p) => p.slice(0, 300)) : [],
    subtheme: typeof note?.subtheme === 'string' ? note.subtheme.slice(0, 80) : (typeof note?.subcategory === 'string' ? note.subcategory.slice(0, 80) : ''),
    topicPath: Array.isArray(note?.topicPath) ? note.topicPath.filter((t) => typeof t === 'string').slice(0, 4) : [],
  }));

  if (!name && !notes.length) return { error: { status: 400, code: 'INVALID_INPUT', message: 'Salve ao menos uma nota nesta matéria para gerar este conteúdo.' } };

  const format = ['dialogue', 'single', 'drive'].includes(subject.format) ? subject.format : undefined;
  // "grade" corrects one written answer against its model answer.
  let grading;
  if (action === 'grade') {
    const raw = body?.grading && typeof body.grading === 'object' ? body.grading : {};
    grading = {
      question: typeof raw.question === 'string' ? raw.question.trim().slice(0, 400) : '',
      modelAnswer: typeof raw.modelAnswer === 'string' ? raw.modelAnswer.trim().slice(0, 800) : '',
      answer: typeof raw.answer === 'string' ? raw.answer.trim().slice(0, 1500) : '',
    };
    if (!grading.question || !grading.answer) return { error: { status: 400, code: 'INVALID_INPUT', message: 'Escreva sua resposta para receber a correção.' } };
  }
  // Preferences go through service.normalizeLearningPreferences — the one allowlist.
  return { input: { action, subject: { name: name || 'Matéria', notes, format }, preferences: body?.preferences, grading } };
}

export default defineRoute({
  method: 'POST',
  // Correcting written answers has its own burst budget: a review session of a
  // dozen answers must not block the next podcast/exam generation.
  scope: (body) => (body?.action === 'grade' ? 'grade' : 'subject'),
  burstPerMinute: (body) => (body?.action === 'grade' ? 20 : 10),
  auth: 'session',
  integrity: true,
  // Grading answers is free (prod-web-android-spec.md D6); the "grade" burst
  // bucket above keeps it from becoming a free general-purpose AI.
  cost: (body) => (body?.action === 'grade' ? 0 : 1),
  byok: 'optional',
  validate: safeInput,
  run: (input, ctx) => runSubjectAI({ ...input, credentials: ctx.byok }),
});
