import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeAgainstModel } from '../shared/answerGrading.js';
import { randomUUID } from 'node:crypto';
import subjectAI from '../api/subject-ai.js';
import { issueSession } from '../api/_lib/session.js';
import { resetMemoryStore } from '../api/_lib/store.js';
import { BASE_ENV, makeReq, makeRes, withEnv } from './helpers/http.js';

const modelAnswer = 'A fábrica concentrou máquinas e trabalhadores no mesmo espaço, dividiu a produção em etapas e impôs uma rotina controlada.';

test('an empty answer scores zero and says what to do', () => {
  const result = gradeAgainstModel({ answer: '   ', modelAnswer });
  assert.equal(result.score, 0);
  assert.ok(result.missing.length > 0);
});

test('an answer covering the model answer scores high; a vague one scores low', () => {
  const strong = gradeAgainstModel({ answer: 'As fábricas juntaram máquinas e trabalhadores, dividindo a produção em etapas com rotina controlada.', modelAnswer });
  const vague = gradeAgainstModel({ answer: 'Mudou bastante coisa naquela época.', modelAnswer });
  assert.ok(strong.score >= 8, `strong scored ${strong.score}`);
  assert.ok(vague.score <= 4, `vague scored ${vague.score}`);
  assert.ok(strong.score > vague.score);
  assert.ok(vague.missing.length > 0);
});

test('grading tolerates accents and inflection (fábrica/fabricas)', () => {
  const result = gradeAgainstModel({ answer: 'fabricas maquinas trabalhador producao etapa rotina controlado espaco concentrou dividiu', modelAnswer });
  assert.ok(result.score >= 8, `scored ${result.score}`);
});

function signedHeaders(sub) {
  return { authorization: `Bearer ${issueSession({ sub, email: `${sub}@example.com` })}`, 'idempotency-key': randomUUID() };
}

async function grade(sub, body) {
  const res = makeRes();
  await subjectAI(makeReq({ url: '/api/subject-ai', headers: signedHeaders(sub), body }), res);
  return res;
}

test('the subject-ai handler grades a written answer (demo mode) without charging a credit', () => withEnv({ ...BASE_ENV, JOVI_LENS_DEMO_MODE: 'true' }, async () => {
  resetMemoryStore();
  const res = await grade('grader', { action: 'grade', subject: { name: 'História', notes: [] }, grading: { question: 'Como a fábrica mudou o trabalho?', modelAnswer, answer: 'A fábrica juntou máquinas e trabalhadores e dividiu a produção.' } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.score > 0 && res.body.score <= 10);
  assert.ok(typeof res.body.feedback === 'string' && res.body.feedback.length > 0);
  assert.equal(res.headers['x-jovi-credits-remaining'], '3', 'grading is free (prod-web-android-spec.md D6)');

  const missing = await grade('grader', { action: 'grade', subject: { name: 'História' }, grading: { question: 'x', modelAnswer, answer: '' } });
  assert.equal(missing.statusCode, 400);
}));

test('grading has its own burst bucket, separate from generation', () => withEnv({ ...BASE_ENV, JOVI_LENS_DEMO_MODE: 'true', JOVI_FREE_CREDITS: '100' }, async () => {
  resetMemoryStore();
  const body = { action: 'grade', subject: { name: 'História', notes: [] }, grading: { question: 'q', modelAnswer, answer: 'máquinas e trabalhadores' } };
  for (let i = 0; i < 20; i += 1) assert.equal((await grade('burst', body)).statusCode, 200);
  assert.equal((await grade('burst', body)).body.code, 'RATE_LIMITED');
  // Generation still has its own 10/min.
  const questions = await grade('burst', { action: 'questions', subject: { name: 'História', notes: [{ title: 'Revolução Industrial', text: 'fábricas' }] } });
  assert.equal(questions.statusCode, 200);
}));
