import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_SUBJECT_ARTIFACTS, mergeDemoSubjectArtifacts, stripDemoSubjectArtifacts } from '../shared/demoSubjectArtifacts.js';

test('História demo studio is preloaded with presentation artifacts', () => {
  const history = DEMO_SUBJECT_ARTIFACTS.História;

  assert.ok(history.questions.data.questions.length >= 7);
  assert.ok(history.exam.data.questions.length >= 6);
  assert.ok(history.examResult.data.percent > 0);
  assert.equal(history.podcast.data.format, 'dialogue');
  assert.equal(history.podcast.data.durationMinutes, 10);
  assert.ok(history.podcast.data.segments.some((segment) => segment.speaker === 'A'));
  assert.ok(history.podcast.data.segments.some((segment) => segment.speaker === 'B'));
  assert.equal(history.podcasts.data.formats.dialogue.format, 'dialogue');
  assert.equal(history.podcasts.data.formats.single.format, 'single');
  assert.equal(history.podcasts.data.formats.drive.format, 'drive');
  assert.ok(history.podcasts.data.formats.single.segments.every((segment) => segment.speaker === 'narrator'));
  assert.ok(history.podcasts.data.formats.drive.durationMinutes === 10);
  assert.ok(history.podcasts.data.formats.drive.segments.some((segment) => segment.speaker === 'coach'));
  assert.ok(history.podcasts.data.formats.drive.segments.some((segment) => segment.speaker === 'feedback'));
  assert.ok(history.podcasts.data.formats.drive.interactions.length >= 3);
  assert.ok(history.questions.data.questions.some((item) => item.topic === 'Mecanização têxtil'));
  assert.ok(history.questions.data.questions.some((item) => item.topic === 'Trabalho infantil e leis fabris'));
  assert.ok(history.videoRecommendations.data.videos.some((video) => video.saved && video.url.includes('youtube.com/watch?v=')));
  assert.ok(history.videoRecommendations.data.videos.every((video) => video.channelTitle && video.thumbnail));
  assert.ok(history.lesson.data.slides.length >= 8);
  assert.ok(history.plan.data.sessions.length >= 4);
  assert.equal(history.plan.data.calendarEvent.source, 'Outlook');
  assert.match(history.plan.data.overview, /Outlook/);
});

test('mergeDemoSubjectArtifacts fills missing demo data without overwriting user artifacts', () => {
  const customQuestions = { data: { subject: 'História', questions: [{ question: 'custom' }] }, savedAt: 'user' };
  const { artifacts, changed } = mergeDemoSubjectArtifacts({ História: { questions: customQuestions } });

  assert.equal(changed, true);
  assert.equal(artifacts.História.questions, customQuestions);
  assert.ok(artifacts.História.podcast.data.segments.length > 0);
});

test('mergeDemoSubjectArtifacts refreshes legacy seeded demo artifacts', () => {
  const legacyPodcast = {
    savedAt: '2026-09-17T12:00:00.000Z',
    data: { subject: 'História', mode: 'demo', provider: 'demo', model: 'seeded-demo', format: 'dialogue', title: 'antigo', segments: [] },
  };
  const { artifacts, changed } = mergeDemoSubjectArtifacts({ História: { podcast: legacyPodcast } });

  assert.equal(changed, true);
  assert.notEqual(artifacts.História.podcast.data.title, 'antigo');
  assert.ok(artifacts.História.podcast.data.segments.length > 0);
});

test('example content is preloaded but no score is attributed to the student', () => {
  // Regression: a fresh install showed História at "86% · Pronto para a prova"
  // because the seeded exam RESULT was stored as the student's own.
  const { artifacts } = mergeDemoSubjectArtifacts({});
  assert.ok(artifacts.História.exam, 'the prepared exam stays available to take');
  assert.equal(artifacts.História.examResult, undefined);
  assert.equal(artifacts.História.planProgress, undefined);
});

test('a previously seeded score is removed while a real one is kept', () => {
  const seeded = DEMO_SUBJECT_ARTIFACTS.História.examResult;
  const { artifacts: cleaned, changed } = mergeDemoSubjectArtifacts({ História: { examResult: seeded } });
  assert.equal(changed, true);
  assert.equal(cleaned.História.examResult, undefined);

  const real = { data: { percent: 40, score: 2, total: 5 }, savedAt: '2026-09-25T10:00:00.000Z' };
  const { artifacts: kept } = mergeDemoSubjectArtifacts({ História: { examResult: real } });
  assert.equal(kept.História.examResult, real);
});

test('a podcast the student generated survives the next launch', () => {
  // Regression: saving { ...seededPodcasts, formats } kept the seed's demo
  // markers, so the merge put the seeded episode back on the next launch.
  const seeded = DEMO_SUBJECT_ARTIFACTS.História.podcasts.data;
  const mine = { format: 'drive', title: 'Meu episódio', mode: 'live', provider: 'azure-openai', segments: [{ speaker: 'coach', text: 'oi' }] };
  const saved = { data: { formats: { ...seeded.formats, drive: mine } }, savedAt: '2026-09-26T20:00:00.000Z' };
  const { artifacts } = mergeDemoSubjectArtifacts({ História: { podcasts: saved } });
  assert.equal(artifacts.História.podcasts.data.formats.drive.title, 'Meu episódio');
});

test('stripDemoSubjectArtifacts removes seeded data a demo build left and keeps the student\'s own', () => {
  const seeded = mergeDemoSubjectArtifacts({}).artifacts;
  const own = { savedAt: '2026-10-01T10:00:00.000Z', data: { provider: 'minimax', mode: 'live', questions: [] } };
  const { artifacts, changed } = stripDemoSubjectArtifacts({ ...seeded, História: { ...seeded.História, questions: own } });
  assert.equal(changed, true);
  assert.deepEqual(artifacts, { História: { questions: own } });
  assert.deepEqual(stripDemoSubjectArtifacts(artifacts), { artifacts, changed: false });
});
