import { isDemoMode } from './env.js';
import { apiFetch } from './apiClient.js';

const DEMO_STYLE_LABELS = {
  animated: 'animada e visual',
  balanced: 'equilibrada',
  calm: 'calma e detalhada',
  exam: 'focada em exercícios',
};
const DEMO_GOAL_LABELS = {
  vestibular: 'vestibular',
  enem: 'ENEM',
  school_exam: 'prova da escola',
  general: 'revisão geral',
};
const DEMO_PRACTICE_LABELS = {
  concept_first: 'conceitos explicados',
  questions_first: 'questões resolvidas',
  mixed: 'explicação e exercícios',
};
const DEMO_REVIEW_LABELS = {
  spaced: 'revisão espaçada',
  retrieval: 'teste ativo',
  interleaved: 'comparação de temas',
  flashcards: 'flashcards',
};

function searchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function demoRecommendations(subject, preferences = {}) {
  const name = String(subject?.name || 'a matéria').trim();
  const style = DEMO_STYLE_LABELS[preferences.videoStyle] || DEMO_STYLE_LABELS.balanced;
  const goal = DEMO_GOAL_LABELS[preferences.studyGoal] || DEMO_GOAL_LABELS.vestibular;
  const practice = DEMO_PRACTICE_LABELS[preferences.practiceMode] || DEMO_PRACTICE_LABELS.mixed;
  const review = DEMO_REVIEW_LABELS[preferences.reviewMethod] || DEMO_REVIEW_LABELS.spaced;
  const query = `${name} aula ${goal} ${practice} ${review} ${style}`.slice(0, 180);
  return {
    mode: 'demo',
    query,
    focus: `Busca de demonstração para ${name}.`,
    reason: `prioriza ${goal}, ${practice}, ${review} e uma aula ${style}`,
    videos: [{
      id: 'demo-video-search',
      title: `Aula-base de ${name}`,
      description: 'Use a busca sugerida para encontrar uma aula que combine com seu estilo de aprendizagem.',
      channelTitle: 'Busca sugerida',
      sourceLabel: 'Busca sugerida',
      thumbnail: '',
      url: searchUrl(query),
      searchQuery: query,
      didacticReason: `Procure uma aula que combine ${practice} com ${review}, sem perder clareza.`,
      watchFor: ['Explicação passo a passo', 'Exercício resolvido', 'Resumo no final', review],
      estimatedMinutes: preferences.duration === 'short' ? 12 : preferences.duration === 'long' ? 45 : 25,
    }],
  };
}

export async function findVideoLessons(subject, preferences) {
  if (isDemoMode()) return demoRecommendations(subject, preferences);

  let response;
  try {
    response = await apiFetch('/api/video-recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, preferences }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
    throw new Error('Sem conexão para recomendar aulas agora. Confira a internet ou ative o modo demonstração.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Não foi possível recomendar uma aula agora.');
  return data;
}
