import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Icon from './Icon.jsx';
import { generateSubjectContent } from '../services/subjectStudy.js';
import { DEMO_SUBJECT_ARTIFACTS } from '../shared/demoSubjectArtifacts.js';
import { buildExamReport } from '../shared/studentDashboard.js';

function formatClock(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function computeByTopic(questions, answers) {
  const byTopic = {};
  (questions || []).forEach((q, index) => {
    const topic = q.topic || 'Geral';
    byTopic[topic] = byTopic[topic] || { correct: 0, total: 0 };
    byTopic[topic].total += 1;
    if (answers[index] === q.answerIndex) byTopic[topic].correct += 1;
  });
  return byTopic;
}

export default function SubjectExam({ subject, savedExam, savedResult, onResult, presentation = false }) {
  const [phase, setPhase] = useState('idle'); // idle | loading | running | done
  const [exam, setExam] = useState(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState('');
  const timerRef = useRef(null);
  const deadlineRef = useRef(0);
  const generationTimeoutRef = useRef(null);
  const answersRef = useRef({});
  const examRef = useRef(null);
  const finishedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearInterval(timerRef.current);
      clearTimeout(generationTimeoutRef.current);
    };
  }, []);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { examRef.current = exam; }, [exam]);
  // Auto-submit when the clock runs out (kept out of the setState updater so
  // StrictMode's double-invocation can't double-fire it).
  useEffect(() => { if (phase === 'running' && secondsLeft === 0) finish(); }, [phase, secondsLeft]);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearInterval(timerRef.current);
    const questions = examRef.current?.questions || [];
    const picked = answersRef.current;
    const correct = questions.filter((q, i) => picked[i] === q.answerIndex).length;
    const summary = {
      subject: examRef.current?.subject || subject.name,
      score: correct,
      total: questions.length,
      percent: questions.length ? Math.round((correct / questions.length) * 100) : 0,
      byTopic: computeByTopic(questions, picked),
      answers: picked,
      questions,
      retry: Boolean(examRef.current?.retry),
      takenAt: new Date().toISOString(),
    };
    setResult(summary);
    setPhase('done');
    onResult?.(summary);
  }

  // The clock counts down from a fixed deadline: JS timers pause while the app
  // is in the background, so decrementing a counter every second let the
  // student leave the app and come back with the same time left.
  function run(examData) {
    clearInterval(timerRef.current);
    clearTimeout(generationTimeoutRef.current);
    setError('');
    setAnswers({});
    answersRef.current = {};
    finishedRef.current = false;
    setResult(null);
    setCurrent(0);
    setExam(examData);
    examRef.current = examData;
    const totalSeconds = Math.max(60, Math.round((examData.durationMinutes || 10) * 60));
    deadlineRef.current = Date.now() + totalSeconds * 1000;
    setSecondsLeft(totalSeconds);
    setPhase('running');
    timerRef.current = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
    }, 1000);
  }

  async function generateNew() {
    setPhase('loading');
    setLoadingLabel(`Gerando novo simulado de ${subject.name}...`);
    setError('');
    try {
      const generated = await generateSubjectContent(subject, { action: 'exam' });
      if (!mountedRef.current) return; // unmounted during the request — don't start a leaked timer
      if (!generated.questions?.length) throw new Error('Não foi possível montar o simulado agora.');
      run(generated);
    } catch (err) {
      setError(err.message || 'Falha ao gerar o simulado.');
      setPhase('idle');
    }
  }

  function openReadyResult() {
    if (!savedResult) return;
    clearInterval(timerRef.current);
    const readyExam = savedExam || { subject: subject.name, durationMinutes: 10, questions: savedResult.questions || [] };
    setExam(readyExam);
    examRef.current = readyExam;
    setResult(savedResult);
    setPhase('done');
  }

  // The exam the student last took comes first, so "Refazer este simulado"
  // repeats what they just saw — not an older seeded one.
  function getReadyExam() {
    return (savedResult?.questions?.length && !savedResult.retry ? { subject: subject.name, durationMinutes: 10, questions: savedResult.questions } : null)
      || savedExam
      || (presentation ? DEMO_SUBJECT_ARTIFACTS[subject.name]?.exam?.data : null)
      || null;
  }

  // Pitch-only: opens the prepared exam behind a short "generating" beat so the
  // demo never depends on a live call. Outside presentation mode the UI offers
  // the honest pair instead: retake the saved exam, or generate a new one.
  function stagedPresentationExam() {
    const readyExam = getReadyExam();
    if (!readyExam?.questions?.length) { generateNew(); return; }
    setPhase('loading');
    setLoadingLabel(`Gerando novo simulado de ${subject.name}...`);
    generationTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) run(readyExam);
    }, 1200);
  }

  function retakeSaved() {
    const readyExam = getReadyExam();
    if (readyExam?.questions?.length) run(readyExam);
    else generateNew();
  }

  // Targeted practice: only the questions answered wrong (or left blank), with
  // time scaled to their count.
  function retryMistakes() {
    const source = result?.questions || [];
    const wrong = source.filter((q, index) => result.answers?.[index] !== q.answerIndex);
    if (!wrong.length) return;
    run({ subject: subject.name, retry: true, durationMinutes: Math.max(2, Math.ceil(wrong.length * 1.5)), questions: wrong });
  }

  if (phase === 'idle') {
    return (
      <View className="gap-3">
        <View className="gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon name="target" size={13} color="#4f46e5" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Simulado da matéria</Text>
          </View>
          <Text className="text-[16px] font-bold text-slate-900">Prova rápida de {subject.name}</Text>
          <Text className="text-[13px] text-slate-600">Questões de múltipla escolha cobrindo os {subject.subthemes.length} subtemas que você estudou, com nota e diagnóstico dos pontos fracos.</Text>
        </View>
        {savedResult ? (
          <View className="flex-row items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
            <Icon name="history" size={14} color="#64748b" />
            <Text className="text-[13px] text-slate-600">Último resultado: <Text className="font-bold text-slate-900">{savedResult.percent}%</Text> ({savedResult.score}/{savedResult.total})</Text>
          </View>
        ) : null}
        {error ? <View className="rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert"><Text className="text-[13px] text-red-600">{error}</Text></View> : null}
        {savedResult ? (
          <Pressable accessibilityRole="button" onPress={openReadyResult} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-3">
            <Icon name="history" size={16} color="#475569" />
            <Text className="text-[14px] font-semibold text-slate-600">Ver último resultado</Text>
          </Pressable>
        ) : null}
        {presentation ? (
          <Pressable accessibilityRole="button" onPress={stagedPresentationExam} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
            <Icon name="target" size={16} color="#ffffff" />
            <Text className="text-[14px] font-semibold text-white">Fazer simulado</Text>
          </Pressable>
        ) : (
          <>
            {getReadyExam() ? (
              <Pressable accessibilityRole="button" onPress={retakeSaved} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 py-3">
                <Icon name="rotate" size={16} color="#4f46e5" />
                <Text className="text-[14px] font-semibold text-indigo-700">{savedResult ? 'Refazer este simulado' : 'Fazer o simulado pronto'}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={generateNew} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
              <Icon name="sparkle" size={16} color="#ffffff" />
              <Text className="text-[14px] font-semibold text-white">{getReadyExam() ? 'Gerar novo simulado' : 'Fazer simulado'}</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View className="flex-row items-center gap-2 py-4">
        <ActivityIndicator color="#4f46e5" />
        <Text className="text-[13px] text-slate-500">{loadingLabel}</Text>
      </View>
    );
  }

  if (phase === 'done' && result) {
    const weakTopics = Object.entries(result.byTopic).filter(([, v]) => v.correct < v.total);
    const report = buildExamReport(result);
    return (
      <View className="gap-4">
        <View className={`items-center gap-1 rounded-2xl px-4 py-6 ${result.percent >= 60 ? 'bg-emerald-50' : 'bg-red-50'}`}>
          <Text className={`text-[32px] font-black ${result.percent >= 60 ? 'text-emerald-600' : 'text-red-600'}`}>{result.percent}%</Text>
          <Text className="text-[13px] text-slate-500">{result.score} de {result.total} corretas</Text>
        </View>
        <View className="gap-2 rounded-2xl bg-indigo-50 px-3 py-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Relatório inteligente</Text>
          <Text className="text-[15px] font-bold text-slate-900">{report.grade}</Text>
          <Text className="text-[12px] text-slate-600">{report.summary}</Text>
          {report.nextSteps.map((step) => (
            <View key={step} className="flex-row gap-2">
              <Text className="text-[12px] font-bold text-indigo-500">•</Text>
              <Text className="flex-1 text-[12px] text-slate-600">{step}</Text>
            </View>
          ))}
        </View>
        <View className="gap-2">
          <View className="flex-row items-center gap-1.5">
            <Icon name="target" size={13} color="#64748b" />
            <Text className="text-[12px] font-semibold text-slate-500">Diagnóstico por subtema</Text>
          </View>
          {Object.entries(result.byTopic).map(([topic, v]) => (
            <View key={topic} className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <Text className="text-[13px] text-slate-700">{topic}</Text>
              <Text className={`text-[13px] font-bold ${v.correct === v.total ? 'text-emerald-600' : v.correct === 0 ? 'text-red-600' : 'text-slate-500'}`}>{v.correct}/{v.total}</Text>
            </View>
          ))}
        </View>
        {weakTopics.length ? (
          <View className="flex-row items-start gap-1.5">
            <Icon name="sparkle" size={13} color="#4f46e5" />
            <Text className="flex-1 text-[13px] text-slate-600">Priorize revisar: {weakTopics.map(([t]) => t).join(', ')}.</Text>
          </View>
        ) : null}
        <View className="gap-2">
          <Text className="text-[12px] font-semibold text-slate-500">Revisão das questões</Text>
          {result.questions.map((q, index) => {
            const right = result.answers[index] === q.answerIndex;
            return (
              <View key={index} className={`gap-1 rounded-xl border px-3 py-2.5 ${right ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <View className="flex-row items-start gap-2">
                  <Icon name={right ? 'check' : 'close'} size={14} color={right ? '#16a34a' : '#dc2626'} />
                  <Text className="flex-1 text-[13px] font-bold text-slate-900">{q.question}</Text>
                </View>
                <Text className="text-[12px] text-slate-600"><Text className="font-semibold">Correta:</Text> {q.options[q.answerIndex]}</Text>
                {!right && result.answers[index] != null ? (
                  <Text className="text-[12px] text-slate-600"><Text className="font-semibold">Você:</Text> {q.options[result.answers[index]]}</Text>
                ) : null}
                {q.explanation ? <Text className="text-[12px] text-slate-500">{q.explanation}</Text> : null}
              </View>
            );
          })}
        </View>
        {weakTopics.length ? (
          <Pressable accessibilityRole="button" onPress={retryMistakes} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 py-3">
            <Icon name="target" size={15} color="#4f46e5" />
            <Text className="text-[14px] font-semibold text-indigo-700">Refazer só as que errei</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={presentation ? stagedPresentationExam : generateNew} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
          <Icon name="rotate" size={15} color="#ffffff" />
          <Text className="text-[14px] font-semibold text-white">{presentation ? 'Refazer simulado' : 'Gerar novo simulado'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setPhase('idle')} className="items-center py-2">
          <Text className="text-[13px] font-medium text-slate-500">Voltar</Text>
        </Pressable>
      </View>
    );
  }

  // running
  const question = exam.questions[current];
  const selected = answers[current];
  const isLast = current === exam.questions.length - 1;
  const answeredCount = Object.keys(answers).length;
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[12px] font-semibold text-slate-500">Questão {current + 1}/{exam.questions.length}</Text>
        <View className="flex-row items-center gap-1">
          <Icon name="clock" size={13} color={secondsLeft <= 30 ? '#dc2626' : '#94a3b8'} />
          <Text className={`text-[13px] font-semibold ${secondsLeft <= 30 ? 'text-red-600' : 'text-slate-500'}`}>{formatClock(secondsLeft)}</Text>
        </View>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <View className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${((current + 1) / exam.questions.length) * 100}%` }} />
      </View>
      <View className="gap-1.5">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">{question.topic}</Text>
        <Text className="text-[17px] font-bold text-slate-900">{question.question}</Text>
      </View>
      <View className="gap-2">
        {question.options.map((option, index) => {
          const isSelected = selected === index;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={`Alternativa ${String.fromCharCode(65 + index)}: ${option}`}
              key={index}
              onPress={() => setAnswers((a) => ({ ...a, [current]: index }))}
              className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'}`}
            >
              <Text className="w-5 text-[13px] font-bold text-slate-400">{String.fromCharCode(65 + index)}</Text>
              <Text className="flex-1 text-[14px] text-slate-800">{option}</Text>
              <Icon name={isSelected ? 'check' : 'chevron'} size={16} color={isSelected ? '#4f46e5' : '#94a3b8'} />
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row gap-3">
        <Pressable accessibilityRole="button" onPress={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0} className={`flex-1 items-center rounded-xl border border-slate-200 py-3 ${current === 0 ? 'opacity-40' : ''}`}>
          <Text className="text-[14px] font-semibold text-slate-600">Anterior</Text>
        </Pressable>
        {isLast ? (
          <Pressable accessibilityRole="button" onPress={finish} disabled={answeredCount === 0} className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3 ${answeredCount === 0 ? 'opacity-40' : ''}`}>
            <Icon name="check" size={15} color="#ffffff" />
            <Text className="text-[14px] font-semibold text-white">Finalizar ({answeredCount}/{exam.questions.length})</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setCurrent((c) => Math.min(exam.questions.length - 1, c + 1))} className="flex-1 items-center rounded-xl bg-indigo-600 py-3">
            <Text className="text-[14px] font-semibold text-white">Próxima</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
