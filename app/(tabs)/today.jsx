import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../../components/Icon.jsx';
import StudentDashboard from '../../components/StudentDashboard.jsx';
import { useTopInset } from '../../hooks/safeArea.js';
import { useAppData } from '../../context/AppDataContext.jsx';
import { collectStudyActivity } from '../../shared/studentDashboard.js';
import { dueAcrossSubjects } from '../../shared/spacedReview.js';

// The student's day in one place. The dashboard used to sit at the bottom of
// Perfil, below account, plan, nine preference groups and the calendar — about
// seven screens of scrolling before "what should I study today?".
export default function TodayScreen() {
  const router = useRouter();
  const topInset = useTopInset();
  const { user, plan, subjects, notes, aiHistory, subjectArtifacts, studyCalendar } = useAppData();
  const activity = useMemo(() => collectStudyActivity({ aiHistory, notes, subjectArtifacts }), [aiHistory, notes, subjectArtifacts]);
  const firstName = user?.name ? user.name.split(' ')[0] : '';
  // Recomputed per calendar day (a tab kept mounted past midnight kept the old
  // count) and only for matérias that still exist — a renamed or emptied one
  // left a chip that opened nothing.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDayKey(new Date().toDateString());
    });
    return () => subscription.remove();
  }, []);
  const dueReviews = useMemo(() => {
    const names = new Set(subjects.map((subject) => subject.name));
    return dueAcrossSubjects(subjectArtifacts).filter((entry) => names.has(entry.subject));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectArtifacts, subjects, dayKey]);
  const dueTotal = dueReviews.reduce((sum, entry) => sum + entry.due, 0);

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10" contentContainerStyle={{ paddingTop: topInset }}>
        <View className="gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon name="home" size={13} color="#4f46e5" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Seu dia de estudo</Text>
          </View>
          <Text className="text-[24px] font-bold text-slate-900">{firstName ? `Olá, ${firstName}` : 'Hoje'}</Text>
        </View>

        <View className="flex-row gap-2">
          <QuickAction icon="camera" label="Estudar uma foto" onPress={() => router.push('/(tabs)/camera')} primary />
          <QuickAction icon="note" label="Minhas matérias" onPress={() => router.push('/(tabs)/notes')} />
        </View>

        {dueTotal ? (
          <View className="gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <View className="flex-row items-center gap-2">
              <Icon name="clock" size={16} color="#b45309" />
              <Text className="flex-1 text-[15px] font-bold text-slate-900">{dueTotal} {dueTotal === 1 ? 'pergunta para revisar' : 'perguntas para revisar'} hoje</Text>
            </View>
            <Text className="text-[12px] text-slate-600">Revisar no dia certo é o que fixa o conteúdo. Leva poucos minutos.</Text>
            <View className="flex-row flex-wrap gap-2">
              {dueReviews.slice(0, 4).map((entry) => (
                <Pressable
                  key={entry.subject}
                  accessibilityRole="button"
                  accessibilityLabel={`Revisar ${entry.due} de ${entry.subject}`}
                  onPress={() => router.push({ pathname: '/(tabs)/notes', params: { subject: entry.subject, studio: 'questions', t: String(Date.now()) } })}
                  className="flex-row items-center gap-1.5 rounded-full bg-white px-3 py-1.5"
                >
                  <Text className="text-[13px] font-semibold text-amber-800">{entry.subject}</Text>
                  <Text className="text-[12px] font-bold text-amber-600">{entry.due}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Keyed by mode: the dashboard seeds its example inputs on mount, so
            switching presentation on/off must remount it, not reuse state. */}
        <StudentDashboard
          key={plan?.presentationMode ? 'presentation' : 'student'}
          subjects={subjects}
          notes={notes}
          aiHistory={aiHistory}
          subjectArtifacts={subjectArtifacts}
          studyCalendar={studyCalendar}
          activity={activity}
          presentation={Boolean(plan?.presentationMode)}
        />
      </ScrollView>
    </View>
  );
}

function QuickAction({ icon, label, onPress, primary }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 ${primary ? 'bg-indigo-600' : 'border border-slate-200 bg-white'}`}
    >
      <Icon name={icon} size={18} color={primary ? '#ffffff' : '#475569'} />
      <Text className={`text-[14px] font-semibold ${primary ? 'text-white' : 'text-slate-700'}`}>{label}</Text>
    </Pressable>
  );
}

// A crash here stays inside this tab (the tab bar keeps working).
export { default as ErrorBoundary } from '../../components/ErrorScreen.jsx';
