import { getSubjectDemo } from '../shared/demoResponses.js';
import { gradeAgainstModel } from '../shared/answerGrading.js';
import { isDemoMode } from './env.js';
import { apiFetch } from './apiClient.js';
import { getLearningPreferences, getStudyCalendar } from './storage.js';
import { eventsForSubject, normalizeStudyCalendar } from '../shared/studyCalendar.js';

// Only the request half lives here. The subject aggregation is identical on both
// clients and lives in shared/subjects.js; this file keeps what is genuinely
// native-specific — the absolute API base URL and the EXPO_PUBLIC_ demo flag.

// action ∈ questions | exam | plan | podcast-script | lesson-script
export async function generateSubjectContent(subject, { action, format } = {}) {
  const payloadSubject = { name: subject.name, notes: subject.notes, ...(format ? { format } : {}) };
  const studyCalendar = normalizeStudyCalendar(getStudyCalendar());
  const preferences = {
    ...getLearningPreferences(),
    studyCalendar: studyCalendar.connected ? {
      provider: studyCalendar.provider,
      account: studyCalendar.account,
      syncedAt: studyCalendar.syncedAt,
      events: eventsForSubject(studyCalendar, payloadSubject.name),
    } : null,
  };

  if (isDemoMode()) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { ...getSubjectDemo({ action, subject: payloadSubject, preferences }), provider: 'demo', model: 'jovi-lens-demo', mode: 'demo' };
  }

  let response;
  try {
    response = await apiFetch('/api/subject-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, subject: payloadSubject, preferences }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
    throw new Error('Sem conexão no momento. Confira a internet ou ative o modo demonstração.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Não foi possível gerar este conteúdo agora.');
  return data;
}

// Corrects one written answer against the question's model answer. Demo Mode
// grades locally (concept overlap, shared/answerGrading.js) — same shape as live.
export async function gradeAnswer(subject, { question, modelAnswer, answer }) {
  if (isDemoMode()) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { ...gradeAgainstModel({ answer, modelAnswer }), mode: 'demo' };
  }
  let response;
  try {
    response = await apiFetch('/api/subject-ai', {
      method: 'POST',
      body: JSON.stringify({ action: 'grade', subject: { name: subject.name, notes: subject.notes }, grading: { question, modelAnswer, answer }, preferences: getLearningPreferences() }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
    throw new Error('Sem conexão para corrigir agora. Compare com a resposta-modelo e marque você mesmo.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Não foi possível corrigir esta resposta agora.');
  return data;
}
