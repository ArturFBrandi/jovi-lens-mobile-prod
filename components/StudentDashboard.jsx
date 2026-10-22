import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Icon from './Icon.jsx';
import { buildStudentDashboard, gradeDiscursiveAnswer, searchStudyMemory } from '../shared/studentDashboard.js';
import { daysUntilEvent, formatEventDate } from '../shared/studyCalendar.js';

const DEFAULT_ANSWER = 'A fábrica juntou máquinas e trabalhadores no mesmo espaço, dividindo tarefas. Isso aumentou a produção, mas também criou uma rotina mais controlada para os operários.';

function formatTimer(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// `presentation` (plan.presentationMode) turns on the staged pitch numbers and
// pre-filled examples; `activity` feeds the real streak (see shared/studentDashboard.js).
export default function StudentDashboard({ subjects, notes, aiHistory, subjectArtifacts, studyCalendar, activity = [], presentation = false }) {
  const [query, setQuery] = useState(presentation ? 'Revolução Industrial' : '');
  const [answer, setAnswer] = useState(presentation ? DEFAULT_ANSWER : '');
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(10 * 60);
  const [openBlocks, setOpenBlocks] = useState({ flashcards: true });
  const dashboard = useMemo(
    () => buildStudentDashboard({ subjects, subjectArtifacts, studyCalendar, activity, presentation }),
    [subjects, subjectArtifacts, studyCalendar, activity, presentation],
  );
  const searchResults = useMemo(
    () => searchStudyMemory({ query, subjects, notes, aiHistory, subjectArtifacts, studyCalendar }),
    [query, subjects, notes, aiHistory, subjectArtifacts, studyCalendar],
  );
  const correction = useMemo(
    () => gradeDiscursiveAnswer({
      subjectName: dashboard.urgentSubject?.name || 'História',
      prompt: 'Explique como a fábrica mudou o trabalho no século 19.',
      answer,
    }),
    [answer, dashboard.urgentSubject?.name],
  );

  useEffect(() => {
    if (!sessionActive) return undefined;
    const timer = setInterval(() => {
      setSessionSeconds((value) => {
        if (value <= 1) {
          clearInterval(timer);
          setSessionActive(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionActive]);

  function toggleSession() {
    if (!sessionActive && sessionSeconds === 0) setSessionSeconds(dashboard.studySession.minutes * 60);
    else if (!sessionActive && sessionSeconds === 10 * 60 && dashboard.studySession.minutes !== 10) setSessionSeconds(dashboard.studySession.minutes * 60);
    setSessionActive((value) => !value);
  }

  function toggleBlock(block) {
    setOpenBlocks((value) => ({ ...value, [block]: !value[block] }));
  }

  return (
    <View className="gap-4 rounded-2xl border border-indigo-100 bg-white p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Painel geral</Text>
          <Text className="text-[18px] font-bold text-slate-900">Seu plano inteligente</Text>
          <Text className="text-[12px] text-slate-500">{dashboard.headline}</Text>
        </View>
        <Icon name="sparkle" size={20} color="#4f46e5" />
      </View>

      <View className={`gap-3 rounded-2xl px-3 py-3 ${dashboard.readiness.tone === 'ready' ? 'bg-emerald-50' : dashboard.readiness.tone === 'attention' ? 'bg-amber-50' : 'bg-red-50'}`}>
        <View>
          <Text className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Hoje</Text>
          <Text className="text-[17px] font-black text-slate-900">{dashboard.today.title}</Text>
          <Text className="text-[12px] text-slate-600">{dashboard.today.reason}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={toggleSession} className={`flex-row items-center justify-center gap-2 rounded-xl px-3 py-3 ${sessionActive ? 'bg-slate-900' : 'bg-indigo-600'}`}>
          <Icon name={sessionActive ? 'pause' : 'play'} size={14} color="#ffffff" />
          <Text className="text-[13px] font-bold text-white">{sessionActive ? 'Pausar revisão' : dashboard.today.cta}</Text>
        </Pressable>
      </View>

      <DashboardBlock icon="calendar" title="Notificações inteligentes">
        {dashboard.notifications.map((notification) => (
          <View key={notification.id} className={`gap-1 rounded-xl px-3 py-2.5 ${notification.tone === 'risk' ? 'bg-red-50' : notification.tone === 'attention' ? 'bg-amber-50' : 'bg-indigo-50'}`}>
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{notification.label} · {notification.when}</Text>
            <Text className="text-[12px] font-bold text-slate-900">{notification.title}</Text>
            <Text className="text-[11px] text-slate-600">{notification.body}</Text>
            <Text className="text-[10px] font-bold text-indigo-600">{notification.action}</Text>
          </View>
        ))}
      </DashboardBlock>

      <View className="gap-2">
        <View className="rounded-2xl border border-slate-100 bg-white px-3 py-3">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Prontidão para a prova</Text>
          <Text className="text-[14px] font-black text-slate-900">{dashboard.readiness.level}</Text>
          <Text className="text-[11px] text-slate-500">{dashboard.readiness.text}</Text>
        </View>
        <View className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{dashboard.subjectAlert.label}</Text>
          <Text className="text-[14px] font-black text-slate-900">{dashboard.subjectAlert.subject}</Text>
          <Text className="text-[11px] text-slate-500">{dashboard.subjectAlert.action}</Text>
        </View>
      </View>

      {dashboard.nextExam ? (
        <View className="flex-row gap-3 rounded-2xl bg-indigo-50 px-3 py-3">
          <Icon name="calendar" size={17} color="#4f46e5" />
          <View className="flex-1">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Próximo compromisso</Text>
            <Text className="text-[13px] font-bold text-slate-900">{dashboard.nextExam.title}</Text>
            <Text className="text-[11px] text-slate-500">{formatEventDate(dashboard.nextExam)} · em {daysUntilEvent(dashboard.nextExam)} dias</Text>
          </View>
        </View>
      ) : null}

      <View className="gap-2">
        {dashboard.subjectCards.slice(0, 3).map((card) => (
          <View key={card.name} className="gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
            <View className="flex-row justify-between gap-2">
              <View className="flex-1">
                <Text className="text-[14px] font-bold text-slate-900">{card.name}</Text>
                <Text className="text-[11px] text-slate-500">{card.status}</Text>
              </View>
              <Text className="text-[18px] font-black text-indigo-600">{card.progress}%</Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-white">
              <View className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${Math.max(8, card.progress)}%` }} />
            </View>
            <Text className="text-[11px] text-slate-500">{card.nextAction}</Text>
          </View>
        ))}
      </View>

      <View className="gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-3">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Relatório final do aluno</Text>
            <Text className="text-[16px] font-black text-slate-900">{dashboard.finalReport.grade}</Text>
            <Text className="text-[11px] text-slate-600">{dashboard.finalReport.summary}</Text>
          </View>
          <Text className="text-[24px] font-black text-indigo-600">{dashboard.finalReport.progress}%</Text>
        </View>
        <View className="gap-1 rounded-xl bg-white px-3 py-2">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Próximo passo</Text>
          <Text className="text-[12px] font-bold text-slate-900">{dashboard.finalReport.nextAction}</Text>
          <Text className="text-[11px] text-slate-500">Prazo: {dashboard.finalReport.deadline}</Text>
        </View>
      </View>

      <CollapsibleBlock icon="target" title="Ver relatório completo" open={!!openBlocks.report} onToggle={() => toggleBlock('report')}>
        <View className="gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Pontos fortes</Text>
          {dashboard.finalReport.strengths.map((item) => <Text key={item} className="text-[11px] text-slate-600">{item}</Text>)}
        </View>
        <View className="gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Revisar agora</Text>
          {dashboard.finalReport.needsReview.map((item) => <Text key={item} className="text-[11px] text-slate-600">{item}</Text>)}
        </View>
        <View className="gap-1 rounded-xl bg-white px-3 py-2.5">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Resumo para responsáveis</Text>
          <Text className="text-[11px] text-slate-600">{dashboard.finalReport.parentSummary}</Text>
        </View>
      </CollapsibleBlock>

      <CollapsibleBlock icon="history" title="Jornada do aluno" open={!!openBlocks.journey} onToggle={() => toggleBlock('journey')}>
        {dashboard.timeline.map((item) => (
          <View key={item.id} className="gap-1 rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{item.label}</Text>
            <Text className="text-[12px] font-bold text-slate-900">{item.title}</Text>
            <Text className="text-[11px] text-slate-500">{item.detail}</Text>
          </View>
        ))}
      </CollapsibleBlock>

      <View className="gap-2 rounded-2xl bg-indigo-50 px-3 py-3">
        <View className="flex-row items-center justify-between gap-3">
          <View>
            <Text className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Streak e meta</Text>
            <Text className="text-[24px] font-black text-slate-900">{dashboard.streak.days} {dashboard.streak.days === 1 ? 'dia' : 'dias'}</Text>
          </View>
          <Text className="text-[12px] font-bold text-indigo-600">{dashboard.streak.completedThisWeek}/{dashboard.streak.weeklyGoal} metas</Text>
        </View>
        <Text className="text-[11px] text-slate-600">{dashboard.streak.nextMilestone}</Text>
        <View className="flex-row gap-1.5">
          {Array.from({ length: dashboard.streak.weeklyGoal }).map((_, index) => (
            <View key={index} className={`h-2 flex-1 rounded-full ${index < dashboard.streak.completedThisWeek ? 'bg-indigo-600' : 'bg-white'}`} />
          ))}
        </View>
      </View>

      <View className="gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-3">
        <Text className="text-[13px] font-bold text-slate-900">Antes e depois</Text>
        {dashboard.comparison.available ? (
          <>
            <View className="flex-row items-end gap-3">
              <ProgressColumn label="Primeiro simulado" value={dashboard.comparison.before} tone="muted" />
              <ProgressColumn label="Último" value={dashboard.comparison.after} tone="strong" />
            </View>
            <Text className="text-[11px] text-slate-500">{dashboard.comparison.delta >= 0 ? '+' : ''}{dashboard.comparison.delta} pts em {dashboard.comparison.subject}. {dashboard.comparison.caption}</Text>
          </>
        ) : (
          <Text className="text-[12px] text-slate-500">{dashboard.comparison.caption}</Text>
        )}
      </View>

      <View className="gap-2 rounded-2xl bg-slate-50 px-3 py-3">
        <View className="flex-row items-center gap-2">
          <Icon name="waveform" size={16} color="#4f46e5" />
          <Text className="text-[13px] font-bold text-slate-900">{dashboard.audioBriefing.title}</Text>
        </View>
        <Text className="text-[12px] text-slate-600">{dashboard.audioBriefing.script}</Text>
        <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{dashboard.audioBriefing.durationSeconds}s · pronto para ouvir</Text>
      </View>

      <CollapsibleBlock icon="route" title="Plano semanal" open={!!openBlocks.plan} onToggle={() => toggleBlock('plan')}>
        {dashboard.weeklyPlan.map((item) => (
          <View key={item.id} className="flex-row gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="w-14 text-[11px] font-bold text-indigo-500">{item.day}</Text>
            <View className="flex-1">
              <Text className="text-[12px] font-bold text-slate-900">{item.title}</Text>
              <Text className="text-[11px] text-slate-500">{item.subject} · {item.focus} · {item.minutes} min</Text>
            </View>
          </View>
        ))}
      </CollapsibleBlock>

      <DashboardBlock icon="clock" title={dashboard.quickReview.title}>
        <View className="gap-1 rounded-xl bg-indigo-50 px-3 py-2.5">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Tema foco</Text>
          <Text className="text-[13px] font-bold text-slate-900">{dashboard.quickReview.topic}</Text>
          <Pressable accessibilityRole="button" onPress={toggleSession} className={`mt-1 items-center rounded-xl px-3 py-2 ${sessionActive ? 'bg-slate-900' : 'bg-indigo-600'}`}>
            <Text className="text-[16px] font-black text-white">{formatTimer(sessionSeconds)}</Text>
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-100">{sessionActive ? 'Pausar sessão' : 'Iniciar sessão'}</Text>
          </Pressable>
        </View>
        {dashboard.quickReview.steps.map((step) => (
          <View key={step.label} className="rounded-xl bg-slate-50 px-3 py-2">
            <Text className="text-[11px] font-bold text-slate-900">{step.label}</Text>
            <Text className="text-[11px] text-slate-500">{step.text}</Text>
          </View>
        ))}
        <View className="flex-row flex-wrap gap-1.5">
          {dashboard.studySession.phases.map((phase) => (
            <View key={phase.label} className="rounded-full bg-slate-100 px-2.5 py-1">
              <Text className="text-[10px] font-bold text-slate-600">{phase.label} · {phase.minutes} min</Text>
            </View>
          ))}
        </View>
      </DashboardBlock>

      <CollapsibleBlock icon="layers" title="Mapa mental" open={!!openBlocks.map} onToggle={() => toggleBlock('map')}>
        <View className="items-center rounded-2xl bg-slate-50 px-3 py-3">
          <View className="rounded-full bg-slate-900 px-4 py-2">
            <Text className="text-[13px] font-bold text-white">{dashboard.mindMap.center}</Text>
          </View>
          <View className="mt-3 flex-row flex-wrap justify-center gap-2">
            {dashboard.mindMap.nodes.map((node) => (
              <View key={node.id} className="max-w-[46%] rounded-xl border border-white bg-white px-3 py-2">
                <Text className="text-[9px] font-bold uppercase tracking-wide text-indigo-500">{node.connection}</Text>
                <Text className="text-[11px] font-bold text-slate-900">{node.topic}</Text>
                <Text className="text-[10px] text-slate-500">{node.status}</Text>
              </View>
            ))}
          </View>
        </View>
      </CollapsibleBlock>

      <CollapsibleBlock icon="cards" title="Flashcards" open={!!openBlocks.flashcards} onToggle={() => toggleBlock('flashcards')}>
        {dashboard.flashcards.slice(0, 4).map((card) => (
          <View key={card.id} className="gap-1 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{card.priority} · {card.topic}</Text>
            <Text className="text-[12px] font-bold text-slate-900">{card.front}</Text>
            <Text className="text-[11px] text-slate-500">{card.back}</Text>
          </View>
        ))}
      </CollapsibleBlock>

      <DashboardBlock icon="search" title="Buscar nos seus estudos">
        <View className="flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Icon name="search" size={14} color="#64748b" />
          <TextInput
            accessibilityLabel="Buscar em notas, provas, vídeos e plano"
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar em tudo"
            className="flex-1 text-[13px] text-slate-900"
          />
        </View>
        {searchResults.map((result, index) => (
          <View key={`${result.type}-${result.title}-${index}`} className="gap-0.5 rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{result.type} · {result.subject}</Text>
            <Text className="text-[12px] font-bold text-slate-900">{result.title}</Text>
            <Text className="text-[11px] text-slate-500">{result.description}</Text>
          </View>
        ))}
      </DashboardBlock>

      {presentation ? (
      <DashboardBlock icon="note" title="Correção discursiva">
        <TextInput
          accessibilityLabel="Resposta discursiva para correção"
          value={answer}
          onChangeText={setAnswer}
          multiline
          className="min-h-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900"
          textAlignVertical="top"
        />
        <View className="gap-1 rounded-xl bg-indigo-50 px-3 py-2.5">
          <Text className="text-[13px] font-bold text-slate-900">{correction.score}/10 · {correction.level}</Text>
          <Text className="text-[11px] text-slate-600">{correction.feedback}</Text>
          <Text className="text-[11px] text-indigo-600">{correction.missing[0] || 'Sua resposta cobre os pontos principais.'}</Text>
        </View>
      </DashboardBlock>
      ) : null}

      {dashboard.handwrittenCorrection ? (
      <CollapsibleBlock icon="scan" title="Correção por foto" open={!!openBlocks.handwriting} onToggle={() => toggleBlock('handwriting')}>
        <View className="gap-1 rounded-xl border border-dashed border-indigo-200 bg-indigo-50 px-3 py-3">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{dashboard.handwrittenCorrection.imageLabel}</Text>
          <Text className="text-[12px] text-slate-700">{dashboard.handwrittenCorrection.detectedText}</Text>
        </View>
        <View className="gap-1 rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-[13px] font-bold text-slate-900">{dashboard.handwrittenCorrection.score}/10 · {dashboard.handwrittenCorrection.source}</Text>
          <Text className="text-[11px] text-slate-600">{dashboard.handwrittenCorrection.feedback}</Text>
        </View>
      </CollapsibleBlock>
      ) : null}

      <CollapsibleBlock icon="target" title="Ver ranking completo" open={!!openBlocks.ranking} onToggle={() => toggleBlock('ranking')}>
        {dashboard.ranking.map((item) => (
          <View key={item.subject} className="flex-row items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="text-[11px] font-black text-indigo-500">{String(item.position).padStart(2, '0')}</Text>
            <View className="flex-1">
              <Text className="text-[12px] font-bold text-slate-900">{item.subject}</Text>
              <Text className="text-[11px] text-slate-500">{item.risk} · {item.action}</Text>
            </View>
            <Text className="text-[13px] font-black text-slate-900">{item.progress}%</Text>
          </View>
        ))}
      </CollapsibleBlock>
    </View>
  );
}

function DashboardBlock({ icon, title, children }) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5">
        <Icon name={icon} size={15} color="#4f46e5" />
        <Text className="text-[13px] font-bold text-slate-900">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function CollapsibleBlock({ icon, title, open, onToggle, children }) {
  return (
    <View className="gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3">
      <Pressable accessibilityRole="button" onPress={onToggle} className="flex-row items-center gap-2">
        <Icon name={icon} size={15} color="#4f46e5" />
        <Text className="flex-1 text-[13px] font-bold text-slate-900">{title}</Text>
        <Icon name="chevron" size={14} color="#94a3b8" />
      </Pressable>
      {open ? <View className="gap-2">{children}</View> : null}
    </View>
  );
}

function ProgressColumn({ label, value, tone }) {
  return (
    <View className="flex-1 gap-1">
      <View className="h-20 justify-end rounded-xl bg-slate-100 p-1">
        <View className={`rounded-lg ${tone === 'strong' ? 'bg-indigo-600' : 'bg-slate-300'}`} style={{ height: `${Math.max(8, value)}%` }} />
      </View>
      <Text className="text-center text-[11px] font-bold text-slate-500">{label}</Text>
      <Text className="text-center text-[13px] font-black text-slate-900">{value}%</Text>
    </View>
  );
}
