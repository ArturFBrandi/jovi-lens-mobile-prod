import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExamReport,
  buildSmartFlashcards,
  buildStudentDashboard,
  gradeDiscursiveAnswer,
  searchStudyMemory,
} from '../shared/studentDashboard.js';
import { createDemoOutlookCalendar } from '../shared/studyCalendar.js';
import { DEMO_SUBJECT_ARTIFACTS } from '../shared/demoSubjectArtifacts.js';

const now = new Date('2026-09-21T12:00:00-03:00');
const historySubject = {
  name: 'História',
  count: 6,
  subthemes: ['Indústria e fábricas', 'Trabalhadores e movimento operário', 'Transporte e máquinas a vapor'],
  notes: [
    {
      title: 'Movimento operário',
      summary: 'Trabalhadores reunidos nas cidades criaram sindicatos e greves.',
      keyPoints: ['A concentração operária favoreceu organização coletiva'],
      category: 'História',
      subcategory: 'Trabalhadores e movimento operário',
    },
  ],
};

test('buildStudentDashboard prioritizes the next Outlook exam', () => {
  const dashboard = buildStudentDashboard({
    subjects: [historySubject, { name: 'Geografia', count: 1, subthemes: ['Cartografia'], notes: [] }],
    subjectArtifacts: DEMO_SUBJECT_ARTIFACTS,
    studyCalendar: createDemoOutlookCalendar(now),
    presentation: true,
    now,
  });

  assert.equal(dashboard.nextExam.subject, 'História');
  assert.equal(dashboard.urgentSubject.name, 'História');
  assert.equal(dashboard.weeklyPlan.length, 5);
  assert.equal(dashboard.timeline.length, 4);
  assert.ok(dashboard.streak.days >= 3);
  assert.equal(dashboard.comparison.subject, 'História');
  assert.ok(dashboard.quickReview.title.includes('prova'));
  assert.equal(dashboard.studySession.status, 'Pronto para iniciar');
  assert.equal(dashboard.mindMap.center, 'História');
  assert.equal(dashboard.handwrittenCorrection.source, 'Foto do caderno');
  assert.ok(dashboard.ranking.some((item) => item.subject === 'História'));
  assert.equal(dashboard.today.cta, 'Começar revisão');
  assert.equal(dashboard.today.subject, 'História');
  assert.equal(dashboard.readiness.level, 'Pronto para a prova');
  assert.equal(dashboard.readiness.tone, 'ready');
  assert.equal(dashboard.audioBriefing.title, 'Resumo falado do painel');
  assert.ok(dashboard.audioBriefing.script.includes('História'));
  assert.ok(dashboard.subjectAlert.subject);
  assert.ok(['Matéria estável', 'Matéria em atenção', 'Sem diagnóstico'].includes(dashboard.subjectAlert.label));
  assert.equal(dashboard.notifications.length, 3);
  assert.equal(dashboard.notifications[0].id, 'exam-reminder');
  assert.equal(dashboard.notifications[0].action, 'Abrir plano');
  assert.equal(dashboard.finalReport.subject, 'História');
  assert.equal(dashboard.finalReport.progress, 86);
  assert.ok(dashboard.finalReport.summary.includes('prova em 7 dias'));
  assert.ok(dashboard.finalReport.needsReview.some((item) => item.includes('Trabalhadores e movimento operário')));
  assert.ok(dashboard.weeklyPlan[0].title.includes('Outlook') || dashboard.weeklyPlan[0].title.includes('Revisar'));
});

test('buildStudentDashboard prefers subjects with saved study signals before empty subjects', () => {
  const dashboard = buildStudentDashboard({
    subjects: [{ name: 'Artes', count: 1, subthemes: ['Cor'], notes: [] }, historySubject],
    subjectArtifacts: DEMO_SUBJECT_ARTIFACTS,
    studyCalendar: {},
    now,
  });

  assert.equal(dashboard.urgentSubject.name, 'História');
  assert.equal(dashboard.flashcards[0].topic, 'Trabalhadores e movimento operário');
});

test('buildSmartFlashcards starts from weak exam topics', () => {
  const cards = buildSmartFlashcards(historySubject, DEMO_SUBJECT_ARTIFACTS.História.examResult.data);

  assert.equal(cards[0].topic, 'Trabalhadores e movimento operário');
  assert.equal(cards[0].priority, 'Alta');
  assert.ok(cards[0].back.includes('organização coletiva'));
});

test('gradeDiscursiveAnswer returns actionable feedback', () => {
  const correction = gradeDiscursiveAnswer({
    subjectName: 'História',
    answer: 'A fábrica mudou a produção com máquinas, trabalhadores operários e novos sindicatos nas cidades.',
  });

  assert.ok(correction.score >= 8);
  assert.equal(correction.level, 'Resposta forte');
  assert.ok(correction.modelAnswer.includes('divisão do trabalho'));
});

test('searchStudyMemory finds notes, exams and calendar events', () => {
  const results = searchStudyMemory({
    query: 'História',
    subjects: [historySubject],
    notes: historySubject.notes,
    subjectArtifacts: DEMO_SUBJECT_ARTIFACTS,
    studyCalendar: createDemoOutlookCalendar(now),
  });

  assert.ok(results.some((item) => item.type === 'Calendário' && item.subject === 'História'));
  assert.ok(results.some((item) => item.type === 'Simulado' && item.subject === 'História'));
});

test('buildExamReport suggests next steps from weak topics', () => {
  const report = buildExamReport(DEMO_SUBJECT_ARTIFACTS.História.examResult.data);

  assert.equal(report.grade, 'Pronto para avançar');
  assert.ok(report.summary.includes('Trabalhadores e movimento operário'));
  assert.equal(report.nextSteps.length, 3);
});

test('dashboard flashcards and comparison use presentation result for História', () => {
  const weakLocalResult = {
    ...DEMO_SUBJECT_ARTIFACTS.História.examResult.data,
    score: 1,
    percent: 14,
    byTopic: {
      'Indústria e fábricas': { correct: 0, total: 2 },
      'Trabalhadores e movimento operário': { correct: 0, total: 1 },
      'Transporte e máquinas a vapor': { correct: 0, total: 1 },
      'Mecanização têxtil': { correct: 0, total: 1 },
      'Trabalho infantil e leis fabris': { correct: 0, total: 1 },
      'Exposições industriais e consumo': { correct: 1, total: 1 },
    },
  };
  const dashboard = buildStudentDashboard({
    subjects: [historySubject],
    subjectArtifacts: { História: { examResult: { data: weakLocalResult } } },
    presentation: true,
    now,
  });

  assert.equal(dashboard.urgentSubject.progress, 86);
  assert.deepEqual(dashboard.flashcards.map((card) => card.topic), [
    'Trabalhadores e movimento operário',
    'Indústria e fábricas',
    'Transporte e máquinas a vapor',
  ]);
  assert.equal(dashboard.comparison.after, 86);
});

test('dashboard final report summarizes strengths, gaps and next plan', () => {
  const dashboard = buildStudentDashboard({
    subjects: [historySubject],
    subjectArtifacts: DEMO_SUBJECT_ARTIFACTS,
    studyCalendar: createDemoOutlookCalendar(now),
    now,
  });

  assert.equal(dashboard.finalReport.title, 'Relatório final de História');
  assert.equal(dashboard.finalReport.grade, 'Pronto para apresentar domínio');
  assert.ok(dashboard.finalReport.strengths.length >= 1);
  assert.ok(dashboard.finalReport.needsReview[0].includes('Trabalhadores e movimento operário'));
  assert.ok(dashboard.finalReport.nextPlan.length >= 1);
  assert.ok(dashboard.finalReport.parentSummary.includes('Próximo passo'));
});

test('dashboard smart notifications include exam, daily review and drive audio', () => {
  const dashboard = buildStudentDashboard({
    subjects: [historySubject],
    subjectArtifacts: DEMO_SUBJECT_ARTIFACTS,
    studyCalendar: createDemoOutlookCalendar(now),
    now,
  });

  assert.deepEqual(dashboard.notifications.map((item) => item.id), [
    'exam-reminder',
    'today-review',
    'audio-drive',
  ]);
  assert.equal(dashboard.notifications[0].tone, 'attention');
  assert.ok(dashboard.notifications[1].body.includes('menor bloco'));
  assert.ok(dashboard.notifications[2].title.includes('Podcast'));
});

test('outside presentation mode the dashboard shows only real numbers', () => {
  const weakLocalResult = {
    ...DEMO_SUBJECT_ARTIFACTS.História.examResult.data,
    score: 1,
    total: 7,
    percent: 14,
  };
  const dashboard = buildStudentDashboard({
    subjects: [historySubject],
    subjectArtifacts: { História: { examResult: { data: weakLocalResult } } },
    now,
  });
  assert.equal(dashboard.urgentSubject.progress, 14);
  assert.equal(dashboard.streak.days, 0, 'no activity means no streak');
  assert.equal(dashboard.comparison.available, false, 'one attempt is not a before/after');
  assert.equal(dashboard.handwrittenCorrection, null, 'simulated OCR correction is pitch-only');
});

test('the streak counts consecutive active days and survives until a day passes empty', () => {
  const day = (offset) => new Date(now.getTime() - offset * 86_400_000).toISOString();
  const three = buildStudentDashboard({ subjects: [historySubject], activity: [day(0), day(1), day(1), day(2), day(5)], now });
  assert.equal(three.streak.days, 3);
  const fromYesterday = buildStudentDashboard({ subjects: [historySubject], activity: [day(1), day(2)], now });
  assert.equal(fromYesterday.streak.days, 2);
  const broken = buildStudentDashboard({ subjects: [historySubject], activity: [day(2), day(3)], now });
  assert.equal(broken.streak.days, 0);
});

test('before/after compares the first and latest real exam attempts', () => {
  const dashboard = buildStudentDashboard({
    subjects: [historySubject],
    subjectArtifacts: { História: { examHistory: { data: [{ percent: 40, takenAt: '2026-09-10' }, { percent: 55 }, { percent: 71 }] } } },
    now,
  });
  assert.equal(dashboard.comparison.available, true);
  assert.equal(dashboard.comparison.before, 40);
  assert.equal(dashboard.comparison.after, 71);
  assert.equal(dashboard.comparison.delta, 31);
});
