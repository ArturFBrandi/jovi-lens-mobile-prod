import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoOutlookCalendar,
  daysUntilEvent,
  eventsForSubject,
  nextEventForSubject,
  normalizeStudyCalendar,
} from '../shared/studyCalendar.js';

test('demo Outlook calendar exposes per-subject exam events', () => {
  const calendar = createDemoOutlookCalendar(new Date('2026-09-21T12:00:00-03:00'));
  const historyEvents = eventsForSubject(calendar, 'História');

  assert.equal(calendar.connected, true);
  assert.equal(historyEvents.length, 1);
  assert.match(historyEvents[0].title, /História/);
  assert.equal(daysUntilEvent(historyEvents[0], new Date('2026-09-21T12:00:00-03:00')), 7);
});

test('study calendar normalization drops invalid events and keeps valid exams sorted', () => {
  const calendar = normalizeStudyCalendar({
    connected: true,
    provider: 'outlook',
    events: [
      { title: '', subject: 'História', startsAt: '2026-09-30T08:00:00-03:00' },
      { title: 'Prova B', subject: 'Geografia', startsAt: '2026-10-10T08:00:00-03:00' },
      { title: 'Prova A', subject: 'História', startsAt: '2026-09-28T08:00:00-03:00' },
    ],
  });

  assert.equal(calendar.events.length, 2);
  assert.equal(nextEventForSubject(calendar, 'historia', new Date('2026-09-21T12:00:00-03:00')).title, 'Prova A');
});
