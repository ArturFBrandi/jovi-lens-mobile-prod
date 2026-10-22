import { daysUntilEvent, formatEventDate, nextEventForSubject, normalizeStudyCalendar } from './studyCalendar.js';
import { DEMO_SUBJECT_ARTIFACTS, getPresentationExamResult } from './demoSubjectArtifacts.js';

const FALLBACK_SUBJECTS = ['História', 'Geografia', 'Biologia', 'Matemática'];
const WEEK_DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function percentOf(result) {
  if (typeof result?.percent === 'number') return Math.max(0, Math.min(100, Math.round(result.percent)));
  if (typeof result?.score === 'number' && typeof result?.total === 'number' && result.total > 0) {
    return Math.round((result.score / result.total) * 100);
  }
  return null;
}

function weakTopicsFromResult(result) {
  return Object.entries(result?.byTopic || {})
    .filter(([, value]) => Number(value.correct || 0) < Number(value.total || 0))
    .map(([topic, value]) => ({
      topic,
      correct: Number(value.correct || 0),
      total: Number(value.total || 0),
      mastery: value.total ? Math.round((Number(value.correct || 0) / Number(value.total || 1)) * 100) : 0,
    }))
    .sort((a, b) => a.mastery - b.mastery);
}

function strongTopicsFromResult(result) {
  return Object.entries(result?.byTopic || {})
    .map(([topic, value]) => ({
      topic,
      correct: Number(value.correct || 0),
      total: Number(value.total || 0),
      mastery: value.total ? Math.round((Number(value.correct || 0) / Number(value.total || 1)) * 100) : 0,
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.mastery - a.mastery);
}

function subjectTopics(subject) {
  const fromSubthemes = Array.isArray(subject?.subthemes) ? subject.subthemes : [];
  const fromNotes = (subject?.notes || []).map((note) => note.subcategory || note.subtheme || note.topicPath?.[0]).filter(Boolean);
  return [...new Set([...fromSubthemes, ...fromNotes])].filter(Boolean);
}

function firstNoteForTopic(subject, topic) {
  const wanted = normalizeText(topic);
  return (subject?.notes || []).find((note) => {
    const haystack = [note.title, note.summary, note.subcategory, note.subtheme, ...(note.topicPath || [])].map(normalizeText).join(' ');
    return haystack.includes(wanted);
  });
}

export function buildSmartFlashcards(subject = {}, examResult = null, limit = 6) {
  const weakTopics = weakTopicsFromResult(examResult).map((item) => item.topic);
  const orderedTopics = [...new Set([...weakTopics, ...subjectTopics(subject)])].slice(0, limit);

  return orderedTopics.map((topic, index) => {
    const note = firstNoteForTopic(subject, topic);
    const keyPoint = note?.keyPoints?.[0] || note?.summary || `Explique ${topic} com um exemplo da matéria.`;
    const front = weakTopics.includes(topic)
      ? `O que ainda falta dominar em ${topic}?`
      : `Qual é a ideia central de ${topic}?`;
    return {
      id: `${normalizeText(subject.name)}-${index}-${normalizeText(topic)}`,
      topic,
      priority: weakTopics.includes(topic) ? 'Alta' : index < 3 ? 'Média' : 'Revisão',
      front,
      back: keyPoint,
    };
  });
}

// `presentation` switches on the staged numbers the pitch relies on (seeded
// História result, synthetic streak and before/after, simulated handwriting
// correction). Off by default: a real student only ever sees numbers derived
// from what they actually did. `activity` is every ISO timestamp of real study
// (history entries, own notes, exam attempts) — the streak is computed from it.
export function buildStudentDashboard({
  subjects = [],
  subjectArtifacts = {},
  studyCalendar = {},
  activity = [],
  presentation = false,
  now = new Date(),
} = {}) {
  const calendar = normalizeStudyCalendar(studyCalendar);
  const knownSubjects = subjects.length
    ? subjects
    : FALLBACK_SUBJECTS.map((name) => ({ name, count: 0, subthemes: [], notes: [] }));

  const subjectCards = knownSubjects.map((subject) => {
    const rawResult = subjectArtifacts?.[subject.name]?.examResult?.data || null;
    let result = getPresentationExamResult(subject, rawResult, { presentation });
    if (presentation && subject.name === 'História') {
      const baseline = DEMO_SUBJECT_ARTIFACTS.História?.examResult?.data || null;
      if (baseline && percentOf(result) < percentOf(baseline)) result = baseline;
    }
    const progress = percentOf(result);
    const weakTopics = weakTopicsFromResult(result);
    const event = nextEventForSubject(calendar, subject.name, now);
    const days = event ? daysUntilEvent(event, now) : null;
    const dueTopics = event?.topics?.length ? event.topics : weakTopics.map((item) => item.topic).slice(0, 3);
    const status = progress == null
      ? 'Sem simulado'
      : progress >= 80
        ? 'Bom domínio'
        : progress >= 60
          ? 'Reforçar lacunas'
          : 'Prioridade alta';
    return {
      name: subject.name,
      progress: progress ?? 0,
      status,
      noteCount: subject.count || subject.notes?.length || 0,
      weakTopics,
      examResult: result,
      nextEvent: event,
      daysUntil: days,
      nextAction: event
        ? `Revisar ${dueTopics[0] || subject.name} antes de ${formatEventDate(event)}`
        : weakTopics[0]
          ? `Refazer questões de ${weakTopics[0].topic}`
          : `Manter revisão leve de ${subject.name}`,
    };
  }).sort((a, b) => {
    const aDays = a.daysUntil ?? 999;
    const bDays = b.daysUntil ?? 999;
    if (aDays !== bDays) return aDays - bDays;
    const aHasStudySignal = a.progress > 0 || a.weakTopics.length > 0;
    const bHasStudySignal = b.progress > 0 || b.weakTopics.length > 0;
    if (aHasStudySignal !== bHasStudySignal) return bHasStudySignal - aHasStudySignal;
    return a.progress - b.progress;
  });

  const nextExam = calendar.events.find((event) => new Date(event.startsAt) >= now) || subjectCards.find((card) => card.nextEvent)?.nextEvent || null;
  const urgentSubject = subjectCards[0] || null;
  const urgentSource = knownSubjects.find((subject) => subject.name === urgentSubject?.name) || knownSubjects[0] || {};
  const flashcards = buildSmartFlashcards(urgentSource, urgentSubject?.examResult || null, 5);
  const weeklyPlan = buildUnifiedWeeklyPlan(subjectCards, now);
  const timeline = buildLearningTimeline({ subjectCards, subjects: knownSubjects, studyCalendar: calendar, now });
  const streak = presentation
    ? buildPresentationStreak({ subjects: knownSubjects, subjectCards })
    : buildStudyStreak({ activity, now });
  const comparison = presentation
    ? buildPresentationComparison(subjectCards)
    : buildProgressComparison({ subjectCards, subjectArtifacts });
  const quickReview = buildQuickReviewPack({ urgentSubject, sourceSubject: urgentSource, flashcards, nextExam, now });
  const studySession = buildStudySession({ urgentSubject, quickReview });
  const mindMap = buildMindMap(urgentSource, urgentSubject?.examResult || null);
  // Simulated feature (no handwriting OCR exists yet) — shown only in the pitch.
  const handwrittenCorrection = presentation ? gradeHandwrittenAnswer({ subjectName: urgentSubject?.name || 'História' }) : null;
  const ranking = buildSubjectRanking(subjectCards);
  const today = buildTodayFocus({ urgentSubject, nextExam, quickReview, now });
  const readiness = buildReadinessStatus({ urgentSubject, nextExam, now });
  const audioBriefing = buildAudioBriefing({ today, readiness, urgentSubject, nextExam, now });
  const subjectAlert = buildSubjectAlert(ranking);
  const notifications = buildSmartNotifications({ today, readiness, urgentSubject, nextExam, ranking, now });
  const finalReport = buildFinalStudentReport({ urgentSubject, nextExam, readiness, flashcards, weeklyPlan, ranking, now });

  return {
    nextExam,
    subjectCards,
    urgentSubject,
    today,
    readiness,
    audioBriefing,
    subjectAlert,
    notifications,
    finalReport,
    flashcards,
    weeklyPlan,
    timeline,
    streak,
    comparison,
    quickReview,
    studySession,
    mindMap,
    handwrittenCorrection,
    ranking,
    headline: nextExam
      ? `Próxima prova: ${nextExam.subject} em ${daysUntilEvent(nextExam, now)} dias`
      : 'Plano geral pronto para a semana',
  };
}

export function buildSmartNotifications({
  today = {},
  readiness = {},
  urgentSubject = null,
  nextExam = null,
  ranking = [],
  now = new Date(),
} = {}) {
  const subject = today.subject || urgentSubject?.name || nextExam?.subject || 'História';
  const topic = today.topic || urgentSubject?.weakTopics?.[0]?.topic || nextExam?.topics?.[0] || subject;
  const days = nextExam ? daysUntilEvent(nextExam, now) : null;
  const riskSubject = ranking.find((item) => item.risk === 'Risco de prova' || item.risk === 'Revisar');
  const notifications = [];

  if (nextExam) {
    notifications.push({
      id: 'exam-reminder',
      tone: days <= 3 ? 'risk' : days <= 7 ? 'attention' : 'ready',
      label: 'Lembrete inteligente',
      title: `${nextExam.subject} em ${days} dias`,
      body: `Revise ${nextExam.topics?.[0] || topic} antes de ${formatEventDate(nextExam)}.`,
      action: 'Abrir plano',
      when: days <= 1 ? 'Hoje' : `${days} dias`,
    });
  }

  notifications.push({
    id: 'today-review',
    tone: readiness.tone || 'attention',
    label: 'Revisão de hoje',
    title: `${today.minutes || 10} min de ${subject}`,
    body: `Comece por ${topic}; é o menor bloco com maior impacto agora.`,
    action: 'Começar revisão',
    when: 'Agora',
  });

  notifications.push({
    id: 'audio-drive',
    tone: 'drive',
    label: 'No caminho',
    title: 'Podcast no carro',
    body: `Use o bate-papo com IA para testar ${topic} sem olhar para a tela.`,
    action: 'Ouvir revisão',
    when: 'No carro',
  });

  if (riskSubject && riskSubject.subject !== subject) {
    notifications.push({
      id: 'risk-subject',
      tone: 'risk',
      label: 'Atenção',
      title: `${riskSubject.subject} precisa de revisão`,
      body: riskSubject.action,
      action: 'Ver ranking',
      when: 'Esta semana',
    });
  }

  return notifications.slice(0, 3);
}

export function buildFinalStudentReport({
  urgentSubject = null,
  nextExam = null,
  readiness = {},
  flashcards = [],
  weeklyPlan = [],
  ranking = [],
  now = new Date(),
} = {}) {
  const subject = urgentSubject?.name || nextExam?.subject || 'História';
  const progress = urgentSubject?.progress ?? 0;
  const weakTopics = urgentSubject?.weakTopics || [];
  const strongTopics = strongTopicsFromResult(urgentSubject?.examResult).slice(0, 3);
  const days = nextExam ? daysUntilEvent(nextExam, now) : null;
  const nextAction = ranking.find((item) => item.subject === subject)?.action || weeklyPlan.find((item) => item.subject === subject)?.title || `Manter revisão de ${subject}`;
  const grade = progress >= 85 ? 'Pronto para apresentar domínio' : progress >= 70 ? 'Bom, com ajustes finais' : progress >= 50 ? 'Precisa revisar antes da prova' : 'Base ainda frágil';

  return {
    subject,
    title: `Relatório final de ${subject}`,
    grade,
    progress,
    nextExamTitle: nextExam?.subject === subject ? nextExam.title : null,
    deadline: days != null ? `${days} dias` : 'sem prova conectada',
    summary: days != null
      ? `${subject} está com ${progress}% de domínio e prova em ${days} dias. ${readiness.text || 'O plano prioriza revisão curta e prática ativa.'}`
      : `${subject} está com ${progress}% de domínio. O plano mantém revisão espaçada e prática ativa.`,
    strengths: strongTopics.length
      ? strongTopics.map((item) => `${item.topic}: ${item.mastery}%`)
      : flashcards.slice(0, 2).map((card) => `Boa base em ${card.topic}`),
    needsReview: weakTopics.length
      ? weakTopics.slice(0, 3).map((item) => `${item.topic}: ${item.mastery}%`)
      : ['Sem lacuna crítica no último simulado'],
    nextPlan: weeklyPlan.filter((item) => item.subject === subject).slice(0, 3).map((item) => ({
      day: item.day,
      title: item.title,
      minutes: item.minutes,
      focus: item.focus,
    })),
    nextAction,
    parentSummary: `${subject}: ${progress}% de domínio. Próximo passo: ${nextAction}.`,
  };
}

export function buildTodayFocus({ urgentSubject = null, nextExam = null, quickReview = null, now = new Date() } = {}) {
  const subject = urgentSubject?.name || nextExam?.subject || 'História';
  const days = nextExam ? daysUntilEvent(nextExam, now) : null;
  const topic = quickReview?.topic || urgentSubject?.weakTopics?.[0]?.topic || nextExam?.topics?.[0] || subject;
  return {
    subject,
    topic,
    minutes: quickReview?.minutes || 10,
    title: days != null ? `Hoje: ${subject} por ${quickReview?.minutes || 10} min` : `Hoje: revisar ${subject}`,
    reason: days != null ? `Prova em ${days} dias · foco em ${topic}` : `Foco em ${topic}`,
    cta: 'Começar revisão',
  };
}

export function buildReadinessStatus({ urgentSubject = null, nextExam = null, now = new Date() } = {}) {
  const progress = urgentSubject?.progress ?? 0;
  const days = nextExam ? daysUntilEvent(nextExam, now) : null;
  const weakTopic = urgentSubject?.weakTopics?.[0]?.topic || nextExam?.topics?.[0] || null;
  if (progress >= 85 && (!days || days > 3)) {
    return {
      level: 'Pronto para a prova',
      tone: 'ready',
      text: weakTopic ? `Só falta revisar ${weakTopic}.` : 'Boa base para seguir praticando.',
    };
  }
  if (progress >= 70) {
    return {
      level: 'Ajuste fino',
      tone: 'attention',
      text: weakTopic ? `Revise ${weakTopic} antes de avançar.` : 'Faça uma rodada curta de questões.',
    };
  }
  return {
    level: 'Atenção',
    tone: 'risk',
    text: weakTopic ? `${weakTopic} precisa entrar na revisão de hoje.` : 'Faça um diagnóstico curto antes do próximo estudo.',
  };
}

export function buildAudioBriefing({ today = {}, readiness = {}, urgentSubject = null, nextExam = null, now = new Date() } = {}) {
  const days = nextExam ? daysUntilEvent(nextExam, now) : null;
  const subject = today.subject || urgentSubject?.name || 'História';
  return {
    title: 'Resumo falado do painel',
    durationSeconds: 38,
    script: days != null
      ? `Você tem ${subject} em ${days} dias. Hoje, faça ${today.minutes || 10} minutos de revisão em ${today.topic}. Status: ${readiness.level}.`
      : `Hoje, faça uma revisão curta de ${subject}, começando por ${today.topic}. Status: ${readiness.level}.`,
  };
}

export function buildSubjectAlert(ranking = []) {
  const risk = ranking.find((item) => item.risk === 'Risco de prova');
  const review = ranking.find((item) => item.risk === 'Revisar');
  const stable = ranking.find((item) => item.risk === 'Estável');
  const picked = risk || review || stable || ranking[0] || { subject: 'História', risk: 'Sem diagnóstico', action: 'Começar revisão' };
  return {
    label: picked.risk === 'Estável' ? 'Matéria estável' : picked.risk === 'Sem diagnóstico' ? 'Sem diagnóstico' : 'Matéria em atenção',
    subject: picked.subject,
    action: picked.action,
    progress: picked.progress || 0,
  };
}

export function buildLearningTimeline({ subjectCards = [], subjects = [], studyCalendar = {}, now = new Date() } = {}) {
  const main = subjectCards[0] || { name: 'História', progress: 0, weakTopics: [] };
  const source = subjects.find((subject) => subject.name === main.name) || {};
  const firstNote = source.notes?.[0];
  const event = main.nextEvent || normalizeStudyCalendar(studyCalendar).events.find((item) => item.subject === main.name && new Date(item.startsAt) >= now);
  return [
    {
      id: 'capture',
      label: 'Foto',
      title: firstNote ? firstNote.title : `Material de ${main.name} salvo`,
      detail: firstNote?.summary || 'O aluno registra uma página, quadro ou exercício com a câmera.',
    },
    {
      id: 'understand',
      label: 'Entender',
      title: `${source.count || source.notes?.length || 0} notas viraram trilha`,
      detail: `A IA organiza subtemas, exemplos e pontos de atenção de ${main.name}.`,
    },
    {
      id: 'practice',
      label: 'Praticar',
      title: `Simulado em ${main.progress}%`,
      detail: main.weakTopics?.[0]
        ? `Lacuna principal: ${main.weakTopics[0].topic}.`
        : 'Sem lacunas fortes no último diagnóstico.',
    },
    {
      id: 'prepare',
      label: 'Preparar',
      title: event ? `${event.subject} em ${daysUntilEvent(event, now)} dias` : 'Revisão semanal montada',
      detail: event ? `Revisão alinhada ao evento ${event.title}.` : 'O painel cria uma rotina curta para manter retenção.',
    },
  ];
}

function localDayKey(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

// Real streak: consecutive local days with study activity, ending today (or
// yesterday — the streak is not "broken" until a whole day passes empty).
// Every timestamp that counts as studying: AI study actions (a bare photo
// capture does not), notes the student created, and exam attempts.
export function collectStudyActivity({ aiHistory = [], notes = [], subjectArtifacts = {} } = {}) {
  const fromHistory = aiHistory.filter((entry) => entry?.action && entry.action !== 'capture').map((entry) => entry.createdAt);
  const fromNotes = notes.filter((note) => !note?.seed).map((note) => note.createdAt);
  const fromExams = Object.values(subjectArtifacts || {}).flatMap((artifacts) => (artifacts?.examHistory?.data || []).map((attempt) => attempt?.takenAt));
  return [...fromHistory, ...fromNotes, ...fromExams].filter(Boolean);
}

export function buildStudyStreak({ activity = [], now = new Date(), weeklyGoal = 5 } = {}) {
  const days = new Set(activity.map(localDayKey).filter(Boolean));
  const cursor = new Date(now);
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  let completedThisWeek = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + offset);
    if (day > now) break;
    if (days.has(localDayKey(day))) completedThisWeek += 1;
  }
  return {
    days: streak,
    weeklyGoal,
    completedThisWeek: Math.min(weeklyGoal, completedThisWeek),
    label: streak === 1 ? '1 dia de sequência' : `${streak} dias de sequência`,
    nextMilestone: streak === 0
      ? 'Estude hoje para começar uma sequência'
      : streak >= 7 ? 'Meta Ouro: manter revisão até a prova' : `Faltam ${7 - streak} ${7 - streak === 1 ? 'dia' : 'dias'} para a Meta Prata`,
  };
}

export function buildPresentationStreak({ subjects = [], subjectCards = [] } = {}) {
  const studiedSubjects = subjectCards.filter((card) => card.progress > 0).length;
  const totalNotes = subjects.reduce((sum, subject) => sum + Number(subject.count || subject.notes?.length || 0), 0);
  const days = Math.max(3, Math.min(12, studiedSubjects + Math.ceil(totalNotes / 4)));
  return {
    days,
    weeklyGoal: 5,
    completedThisWeek: Math.min(5, Math.max(2, studiedSubjects + 2)),
    label: `${days} dias de sequência`,
    nextMilestone: days >= 7 ? 'Meta Ouro: manter revisão até a prova' : 'Meta Prata: completar 7 dias',
  };
}

// Real before/after: the first and the latest recorded exam attempt of the
// same subject. With fewer than two attempts there is nothing to compare, and
// the card says so instead of inventing a "before".
export function buildProgressComparison({ subjectCards = [], subjectArtifacts = {} } = {}) {
  const candidates = subjectCards
    .map((card) => ({ card, attempts: (subjectArtifacts?.[card.name]?.examHistory?.data || []).filter((item) => typeof item?.percent === 'number') }))
    .filter((item) => item.attempts.length >= 2);
  if (!candidates.length) {
    const main = subjectCards.find((card) => card.progress > 0) || subjectCards[0] || { name: 'sua matéria' };
    return { available: false, subject: main.name, before: null, after: null, delta: 0, caption: 'Refaça um simulado para ver sua evolução aqui.' };
  }
  const { card, attempts } = candidates[0];
  const before = attempts[0].percent;
  const after = attempts[attempts.length - 1].percent;
  return {
    available: true,
    subject: card.name,
    before,
    after,
    delta: after - before,
    caption: after > before && card.weakTopics?.[0]
      ? `Continue reforçando ${card.weakTopics[0].topic}.`
      : after > before ? 'A prática está funcionando.' : 'Revise os erros do último simulado antes de tentar de novo.',
  };
}

export function buildPresentationComparison(subjectCards = []) {
  const main = subjectCards.find((card) => card.progress > 0) || subjectCards[0] || { name: 'História', progress: 0, weakTopics: [] };
  const before = Math.max(14, Math.min(52, main.progress - 42));
  return {
    available: true,
    subject: main.name,
    before,
    after: main.progress,
    delta: Math.max(0, main.progress - before),
    caption: main.weakTopics?.[0]
      ? `A melhora veio ao focar em ${main.weakTopics[0].topic}.`
      : 'O aluno consolidou a base e pode avançar para prática.',
  };
}

export function buildQuickReviewPack({ urgentSubject = null, sourceSubject = {}, flashcards = [], nextExam = null, now = new Date() } = {}) {
  const topic = urgentSubject?.weakTopics?.[0]?.topic || nextExam?.topics?.[0] || sourceSubject.subthemes?.[0] || urgentSubject?.name || 'História';
  const minutes = nextExam && daysUntilEvent(nextExam, now) <= 7 ? 10 : 12;
  return {
    title: nextExam ? `Revisão de ${minutes} min antes da prova` : `Revisão rápida de ${urgentSubject?.name || 'História'}`,
    topic,
    minutes,
    steps: [
      { label: 'Flashcards', text: `${Math.min(3, flashcards.length || 3)} cartões sobre ${topic}` },
      { label: 'Perguntas', text: `2 questões objetivas para checar retenção` },
      { label: 'Áudio', text: `1 resumo falado para escutar no caminho` },
    ],
  };
}

export function buildStudySession({ urgentSubject = null, quickReview = null } = {}) {
  const minutes = quickReview?.minutes || 10;
  return {
    subject: urgentSubject?.name || 'História',
    title: `${minutes}:00 foco guiado`,
    minutes,
    phases: [
      { label: 'Aquecimento', minutes: 2 },
      { label: 'Prática', minutes: Math.max(5, minutes - 4) },
      { label: 'Fechamento', minutes: 2 },
    ],
    status: 'Pronto para iniciar',
  };
}

export function buildMindMap(subject = {}, examResult = null) {
  const topics = subjectTopics(subject).slice(0, 6);
  const weakTopics = new Set(weakTopicsFromResult(examResult).map((item) => item.topic));
  const strongTopics = new Set(strongTopicsFromResult(examResult).filter((item) => item.mastery >= 80).map((item) => item.topic));
  return {
    center: subject.name || 'História',
    nodes: topics.map((topic, index) => ({
      id: `${normalizeText(topic)}-${index}`,
      topic,
      status: weakTopics.has(topic) ? 'Revisar' : strongTopics.has(topic) ? 'Dominado' : 'Explorar',
      connection: index === 0 ? 'base' : index % 2 ? 'causa' : 'efeito',
    })),
  };
}

export function gradeHandwrittenAnswer({ subjectName = 'História', answer = 'A fábrica concentrou máquinas, trabalhadores e tarefas, mudando a produção e a vida dos operários.' } = {}) {
  const correction = gradeDiscursiveAnswer({
    subjectName,
    prompt: 'Resposta manuscrita fotografada sobre Revolução Industrial.',
    answer,
  });
  return {
    ...correction,
    source: 'Foto do caderno',
    detectedText: answer,
    imageLabel: 'Resposta manuscrita detectada',
  };
}

export function buildSubjectRanking(subjectCards = []) {
  return subjectCards.map((card, index) => {
    const risk = card.daysUntil != null && card.daysUntil <= 7 && card.progress < 80
      ? 'Risco de prova'
      : card.progress >= 80
        ? 'Estável'
        : card.progress > 0
          ? 'Revisar'
          : 'Sem diagnóstico';
    return {
      position: index + 1,
      subject: card.name,
      progress: card.progress,
      risk,
      action: card.nextAction,
    };
  }).slice(0, 5);
}

export function buildUnifiedWeeklyPlan(subjectCards = []) {
  const queue = subjectCards.length ? subjectCards : FALLBACK_SUBJECTS.map((name) => ({ name, progress: 0, nextAction: `Revisar ${name}` }));
  return WEEK_DAYS.map((day, index) => {
    const card = queue[index % queue.length];
    const minutes = card.daysUntil != null && card.daysUntil <= 7 ? 35 : card.progress < 60 ? 30 : 20;
    const topic = card.weakTopics?.[0]?.topic || card.nextEvent?.topics?.[0] || card.name;
    return {
      id: `${day}-${card.name}`,
      day,
      subject: card.name,
      minutes,
      title: index === 4 ? `Mini simulado de ${card.name}` : card.nextAction,
      focus: topic,
    };
  });
}

export function gradeDiscursiveAnswer({ subjectName = 'História', prompt = '', answer = '' } = {}) {
  const normalized = normalizeText(answer);
  // An empty answer used to score 5/10.
  if (!normalized) {
    return { subject: subjectName, prompt, score: 0, level: 'Escreva sua resposta', feedback: 'Escreva sua resposta para receber a correção.', strengths: [], missing: ['Comece explicando a causa e depois a consequência.'], modelAnswer: '' };
  }
  const expected = ['fabrica', 'maquina', 'trabalho', 'operario', 'producao', 'cidade', 'sindicato'];
  const hits = expected.filter((word) => normalized.includes(word));
  const score = Math.max(5, Math.min(10, 5 + hits.length));
  const missing = expected.filter((word) => !normalized.includes(word)).slice(0, 3);

  return {
    subject: subjectName,
    prompt,
    score,
    level: score >= 8 ? 'Resposta forte' : score >= 6 ? 'Boa base, faltam conexões' : 'Precisa desenvolver',
    feedback: score >= 8
      ? 'Você conectou tecnologia, organização do trabalho e impacto social. Essa é a espinha dorsal de uma resposta de vestibular.'
      : 'A resposta está no caminho, mas precisa ligar causa e consequência: como a mudança técnica alterou a rotina dos trabalhadores e a vida urbana.',
    strengths: hits.slice(0, 3).map((word) => `Usou bem a ideia de ${word}.`),
    missing: missing.map((word) => `Inclua ${word} para deixar a explicação mais completa.`),
    modelAnswer: 'A fábrica concentrou máquinas, trabalhadores e matéria-prima no mesmo espaço. Com a divisão do trabalho, a produção ficou mais rápida, mas a rotina dos operários se tornou repetitiva e controlada, gerando novas tensões sociais.',
  };
}

function addSearchResult(results, result, query) {
  const text = normalizeText(`${result.title} ${result.description} ${result.subject || ''} ${result.type || ''}`);
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
  if (score > 0 || results.length < 4) results.push({ ...result, score });
}

export function searchStudyMemory({ query, subjects = [], notes = [], aiHistory = [], subjectArtifacts = {}, studyCalendar = {} } = {}) {
  const normalizedQuery = normalizeText(query);
  const results = [];
  if (!normalizedQuery) return [];

  notes.forEach((note) => addSearchResult(results, {
    type: 'Nota',
    subject: note.category || 'Geral',
    title: note.title || 'Nota sem título',
    description: note.summary || note.text || 'Conteúdo salvo na memória da IA.',
  }, query));

  subjects.forEach((subject) => addSearchResult(results, {
    type: 'Matéria',
    subject: subject.name,
    title: subject.name,
    description: `${subject.count || subject.notes?.length || 0} notas · ${subjectTopics(subject).slice(0, 3).join(', ')}`,
  }, query));

  Object.entries(subjectArtifacts || {}).forEach(([subjectName, artifacts]) => {
    const result = artifacts?.examResult?.data;
    if (result) addSearchResult(results, {
      type: 'Simulado',
      subject: subjectName,
      title: `Relatório de ${subjectName}`,
      description: `${percentOf(result)}% no último simulado. Lacunas: ${weakTopicsFromResult(result).map((item) => item.topic).join(', ') || 'sem lacunas fortes'}.`,
    }, query);
    const videos = artifacts?.videoRecommendations?.data?.videos || [];
    videos.forEach((video) => addSearchResult(results, {
      type: 'Vídeo',
      subject: subjectName,
      title: video.title,
      description: video.description || video.channel || 'Recomendação de vídeo aula.',
    }, query));
  });

  normalizeStudyCalendar(studyCalendar).events.forEach((event) => addSearchResult(results, {
    type: 'Calendário',
    subject: event.subject,
    title: event.title,
    description: `${formatEventDate(event)} · ${event.topics.join(', ')}`,
  }, query));

  aiHistory.slice(-8).forEach((entry) => addSearchResult(results, {
    type: 'Histórico',
    subject: entry.category || 'IA',
    title: entry.title || 'Interação com IA',
    description: entry.summary || entry.prompt || 'Registro recente do Copilot.',
  }, query));

  return results
    .sort((a, b) => b.score - a.score || String(a.type).localeCompare(String(b.type)))
    .slice(0, 6);
}

export function buildExamReport(result = {}) {
  const percent = percentOf(result) ?? 0;
  const weakTopics = weakTopicsFromResult(result);
  const strongest = Object.entries(result.byTopic || {})
    .map(([topic, value]) => ({ topic, mastery: value.total ? Math.round((value.correct / value.total) * 100) : 0 }))
    .sort((a, b) => b.mastery - a.mastery)[0];
  return {
    percent,
    grade: percent >= 85 ? 'Pronto para avançar' : percent >= 70 ? 'Bom, com ajustes' : percent >= 50 ? 'Revisão necessária' : 'Base frágil',
    summary: weakTopics.length
      ? `Seu maior ganho agora está em ${weakTopics[0].topic}.`
      : 'Você não deixou lacunas importantes neste simulado.',
    nextSteps: [
      weakTopics[0] ? `Rever ${weakTopics[0].topic} por 12 minutos.` : `Resolver uma questão discursiva sobre ${strongest?.topic || result.subject || 'a matéria'}.`,
      'Criar 3 flashcards com erro, causa e exemplo.',
      'Refazer o simulado em 48 horas para confirmar retenção.',
    ],
    weakTopics,
    strongest: strongest?.topic || null,
  };
}
