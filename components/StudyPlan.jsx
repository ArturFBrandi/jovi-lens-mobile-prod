import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Icon from './Icon.jsx';
import { openExternalUrl } from '../services/links.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { generateSubjectContent } from '../services/subjectStudy.js';
import { daysUntilEvent, formatEventDate } from '../shared/studyCalendar.js';

export default function StudyPlan({ subject, savedPlan, savedProgress = {}, savedLessons = [], onSave, onProgressSave }) {
  const { studyCalendar, plan: appPlan } = useAppData();
  const [plan, setPlan] = useState(savedPlan || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(savedProgress);

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const result = await generateSubjectContent(subject, { action: 'plan' });
      if (!result.sessions?.length) throw new Error('Não foi possível montar o plano agora.');
      setPlan(result);
      setDone({});
      onSave?.(result);
      onProgressSave?.({});
    } catch (err) {
      setError(err.message || 'Falha ao gerar o plano.');
    } finally {
      setLoading(false);
    }
  }

  function toggle(key) {
    const next = { ...done, [key]: !done[key] };
    setDone(next);
    onProgressSave?.(next);
  }

  if (loading) {
    return (
      <View className="flex-row items-center gap-2 py-4">
        <ActivityIndicator color="#4f46e5" />
        <Text className="text-[13px] text-slate-500">Montando seu plano de {subject.name}...</Text>
      </View>
    );
  }

  if (!plan) {
    return (
      <View className="gap-3">
        <View className="gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon name="route" size={13} color="#4f46e5" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Plano de estudos</Text>
          </View>
          <Text className="text-[16px] font-bold text-slate-900">Trilha adaptativa de {subject.name}</Text>
          <Text className="text-[13px] text-slate-600">Uma sequência de sessões com revisão espaçada, priorizando os subtemas mais densos do que você já estudou.</Text>
        </View>
        {error ? <View className="rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert"><Text className="text-[13px] text-red-600">{error}</Text></View> : null}
        <SavedLessons lessons={savedLessons} />
        <Pressable accessibilityRole="button" onPress={generate} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
          <Icon name="route" size={16} color="#ffffff" />
          <Text className="text-[14px] font-semibold text-white">Gerar plano</Text>
        </Pressable>
      </View>
    );
  }

  const totalTasks = plan.sessions.reduce((sum, s) => sum + s.tasks.length, 0);
  const doneCount = Object.values(done).filter(Boolean).length;
  const progressPct = totalTasks ? (doneCount / totalTasks) * 100 : 0;

  return (
    <View className="gap-4">
      {plan.overview ? (
        <View className="flex-row items-start gap-1.5">
          <Icon name="sparkle" size={13} color="#4f46e5" />
          <Text className="flex-1 text-[13px] text-slate-600">{plan.overview}</Text>
        </View>
      ) : null}
      {/* A plan only claims a detected exam while a calendar is actually
          connected (or in the pitch) — the preloaded example plan carries one. */}
      {plan.calendarEvent && (studyCalendar?.connected || appPlan?.presentationMode) ? <CalendarDeadline event={plan.calendarEvent} /> : null}
      <View className="gap-1.5">
        <Text className="text-[12px] text-slate-500">{doneCount}/{totalTasks} tarefas</Text>
        <View className="h-2 overflow-hidden rounded-full bg-slate-100">
          <View className="h-2 rounded-full bg-indigo-600" style={{ width: `${progressPct}%` }} />
        </View>
      </View>

      <View className="gap-3">
        {plan.sessions.map((session, sIndex) => (
          <View key={sIndex} className="gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] font-semibold text-indigo-600">{session.label}</Text>
              <View className="flex-row items-center gap-1">
                <Icon name="clock" size={12} color="#94a3b8" />
                <Text className="text-[11px] text-slate-400">{session.durationMinutes} min</Text>
              </View>
            </View>
            <Text className="text-[14px] font-bold text-slate-900">{session.focus}</Text>
            <View className="gap-1.5">
              {session.tasks.map((task, tIndex) => {
                const key = `${sIndex}-${tIndex}`;
                const isDone = Boolean(done[key]);
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={key}
                    onPress={() => toggle(key)}
                    accessibilityState={{ selected: isDone }}
                    className={`flex-row items-center gap-2.5 rounded-xl border px-3 py-2.5 ${isDone ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <View className={`h-5 w-5 items-center justify-center rounded-full ${isDone ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                      <Icon name="check" size={12} color="#ffffff" />
                    </View>
                    <Text className={`flex-1 text-[13px] ${isDone ? 'text-emerald-800 line-through' : 'text-slate-700'}`}>{task}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      {plan.spacedReview?.length ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-1.5">
            <Icon name="history" size={13} color="#64748b" />
            <Text className="text-[12px] font-semibold text-slate-500">Revisão espaçada</Text>
          </View>
          {plan.spacedReview.map((item, index) => (
            <View key={index} className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <Text className="text-[13px] text-slate-700">{item.topic}</Text>
              <Text className="text-[12px] font-semibold text-slate-500">{item.when}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SavedLessons lessons={savedLessons} />

      <Pressable accessibilityRole="button" onPress={generate} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5">
        <Icon name="rotate" size={14} color="#475569" />
        <Text className="text-[13px] font-medium text-slate-600">Gerar novo plano</Text>
      </Pressable>
    </View>
  );
}

function CalendarDeadline({ event }) {
  return (
    <View className="gap-1.5 rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
      <View className="flex-row items-center gap-1.5">
        <Icon name="calendar" size={13} color="#4f46e5" />
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">Prova detectada no {event.source || 'Outlook'}</Text>
      </View>
      <Text className="text-[14px] font-bold text-slate-900">{event.title}</Text>
      <Text className="text-[12px] text-slate-500">{formatEventDate(event)} · em {daysUntilEvent(event)} dias</Text>
      {event.strategy ? <Text className="text-[12px] leading-4 text-slate-600">{event.strategy}</Text> : null}
    </View>
  );
}

function SavedLessons({ lessons = [] }) {
  if (!lessons.length) return null;
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5">
        <Icon name="bookmark" size={13} color="#64748b" />
        <Text className="text-[12px] font-semibold text-slate-500">Buscas de aula salvas</Text>
      </View>
      {lessons.map((lesson) => (
        <Pressable accessibilityRole="button" key={lesson.id} onPress={() => openExternalUrl(lesson.url)} className="flex-row items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-1.5">
              <Icon name="search" size={12} color="#4f46e5" />
              <Text className="flex-1 text-[13px] font-semibold text-slate-900" numberOfLines={1}>{lesson.title}</Text>
            </View>
            <Text className="text-[11px] text-slate-400">{lesson.channelTitle}</Text>
          </View>
          <Icon name="arrow-up-right" size={13} color="#94a3b8" />
        </Pressable>
      ))}
    </View>
  );
}
