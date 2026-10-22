const DAY_MS = 86400000;

export const DEMO_OUTLOOK_CALENDAR = {
  connected: true,
  provider: 'outlook',
  account: 'ana.beatriz@escola.demo',
  syncedAt: '2026-09-21T09:00:00-03:00',
  events: [
    {
      id: 'outlook-history-exam',
      type: 'exam',
      source: 'Outlook',
      subject: 'História',
      title: 'Prova de História · Revolução Industrial',
      startsAt: '2026-09-28T08:00:00-03:00',
      durationMinutes: 60,
      location: 'Sala 12',
      topics: ['Indústria e fábricas', 'Trabalhadores e movimento operário', 'Transporte e máquinas a vapor'],
    },
    {
      id: 'outlook-geography-exam',
      type: 'exam',
      source: 'Outlook',
      subject: 'Geografia',
      title: 'Prova de Geografia · Cartografia',
      startsAt: '2026-10-06T10:00:00-03:00',
      durationMinutes: 50,
      location: 'Sala 8',
      topics: ['Projeções cartográficas', 'Leitura crítica do espaço'],
    },
    {
      id: 'outlook-biology-quiz',
      type: 'exam',
      source: 'Outlook',
      subject: 'Biologia',
      title: 'Quiz de Biologia · Células',
      startsAt: '2026-10-01T14:00:00-03:00',
      durationMinutes: 30,
      location: 'Laboratório',
      topics: ['Células', 'Microscopia'],
    },
  ],
};

export const EMPTY_STUDY_CALENDAR = {
  connected: false,
  provider: null,
  account: '',
  syncedAt: null,
  events: [],
};

export function createDemoOutlookCalendar(now = new Date()) {
  return {
    ...DEMO_OUTLOOK_CALENDAR,
    syncedAt: now.toISOString(),
    events: DEMO_OUTLOOK_CALENDAR.events.map((event) => ({ ...event, topics: [...event.topics] })),
  };
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const startsAt = String(event.startsAt || '');
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) return null;
  const title = String(event.title || '').trim();
  const subject = String(event.subject || '').trim();
  if (!title || !subject) return null;
  return {
    id: String(event.id || `${normalizeText(subject)}-${startsAt}`).slice(0, 120),
    type: event.type === 'assignment' ? 'assignment' : 'exam',
    source: String(event.source || 'Outlook').slice(0, 40),
    subject: subject.slice(0, 80),
    title: title.slice(0, 160),
    startsAt,
    durationMinutes: Number.isFinite(Number(event.durationMinutes)) ? Math.max(10, Math.min(240, Number(event.durationMinutes))) : 60,
    location: String(event.location || '').slice(0, 120),
    topics: Array.isArray(event.topics) ? event.topics.map((topic) => String(topic).trim()).filter(Boolean).slice(0, 8) : [],
  };
}

export function normalizeStudyCalendar(calendar = {}) {
  const events = Array.isArray(calendar.events) ? calendar.events.map(normalizeEvent).filter(Boolean) : [];
  return {
    connected: Boolean(calendar.connected),
    provider: calendar.provider === 'outlook' ? 'outlook' : null,
    account: String(calendar.account || '').slice(0, 120),
    syncedAt: calendar.syncedAt && !Number.isNaN(new Date(calendar.syncedAt).getTime()) ? String(calendar.syncedAt) : null,
    events: events.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
  };
}

export function eventsForSubject(calendar, subjectName) {
  const normalized = normalizeStudyCalendar(calendar);
  const wanted = normalizeText(subjectName);
  if (!normalized.connected || !wanted) return [];
  return normalized.events.filter((event) => normalizeText(event.subject) === wanted);
}

export function nextEventForSubject(calendar, subjectName, now = new Date()) {
  const today = new Date(now);
  return eventsForSubject(calendar, subjectName).find((event) => new Date(event.startsAt) >= today) || null;
}

export function daysUntilEvent(event, now = new Date()) {
  if (!event?.startsAt) return null;
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.ceil((startDay - nowDay) / DAY_MS));
}

export function formatEventDate(event, locale = 'pt-BR') {
  if (!event?.startsAt) return '';
  const date = new Date(event.startsAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
