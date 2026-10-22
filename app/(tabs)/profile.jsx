import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import Icon from '../../components/Icon.jsx';
import { useTopInset } from '../../hooks/safeArea.js';
import { useAnnounce } from '../../hooks/announce.js';
import { useToast } from '../../shared/toast.js';
import { useAppData } from '../../context/AppDataContext.jsx';
import { createBackup, downloadBackup, readBackupFile } from '../../services/dataTransfer.js';
import { confirmAction } from '../../services/confirm.js';
import { signOutGoogle, useGoogleSignIn } from '../../services/googleAuth.js';
import { createDemoOutlookCalendar, daysUntilEvent, EMPTY_STUDY_CALENDAR, formatEventDate } from '../../shared/studyCalendar.js';

const DEMO_USER = {
  id: 'demo-student',
  name: 'Ana Beatriz',
  email: 'ana.beatriz@demo.jovi',
  picture: '',
};

const STUDY_GOAL_OPTIONS = [
  { value: 'vestibular', label: 'Vestibular' },
  { value: 'enem', label: 'ENEM' },
  { value: 'school_exam', label: 'Prova da escola' },
  { value: 'general', label: 'Revisão geral' },
];
const STUDY_CONTEXT_OPTIONS = [
  { value: 'classes', label: 'Acompanhar aulas' },
  { value: 'exam_season', label: 'Período de provas' },
  { value: 'catch_up', label: 'Recuperar atrasos' },
  { value: 'maintenance', label: 'Manter revisão' },
];
const WEEKLY_PACE_OPTIONS = [
  { value: 'light', label: 'Leve · 15 min/dia' },
  { value: 'regular', label: 'Regular · 30 min/dia' },
  { value: 'intense', label: 'Intensivo · 60 min/dia' },
];
const PRACTICE_MODE_OPTIONS = [
  { value: 'concept_first', label: 'Entender primeiro' },
  { value: 'questions_first', label: 'Questões primeiro' },
  { value: 'mixed', label: 'Misto' },
];
const REVIEW_METHOD_OPTIONS = [
  { value: 'spaced', label: 'Revisão espaçada' },
  { value: 'retrieval', label: 'Teste ativo' },
  { value: 'interleaved', label: 'Misturar temas' },
  { value: 'flashcards', label: 'Flashcards' },
];
const VIDEO_STYLE_OPTIONS = [
  { value: 'animated', label: 'Animada e visual' },
  { value: 'balanced', label: 'Equilibrada' },
  { value: 'calm', label: 'Calma e detalhada' },
  { value: 'exam', label: 'Focada em exercícios' },
];
const DURATION_OPTIONS = [
  { value: 'short', label: 'Curta · até 15 min' },
  { value: 'standard', label: 'Média · 15 a 40 min' },
  { value: 'long', label: 'Aprofundada · mais de 40 min' },
];
const LEVEL_OPTIONS = [
  { value: 'beginner', label: 'Estou começando' },
  { value: 'intermediate', label: 'Já tenho base' },
  { value: 'advanced', label: 'Quero aprofundar' },
];

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

export default function ProfileScreen() {
  const { user, setUser, plan, setPlan, records, notes, aiHistory, subjectArtifacts, learningPreferences, setLearningPreferences, studyCalendar, setStudyCalendar, restoreLocalData, clearLocalData } = useAppData();
  // Floating, auto-dismissing feedback: the old inline message rendered at the
  // very bottom of a ~6,000px page, out of sight of the button that caused it.
  const [authMessage, setAuthMessage] = useToast(3600);
  const [exporting, setExporting] = useState(false);
  useAnnounce(authMessage);
  const topInset = useTopInset();
  const { signIn: signInWithGoogle, configured: googleConfigured } = useGoogleSignIn();

  const trialActive = plan.type === 'trial' && new Date(plan.endsAt) > new Date();
  const daysLeft = trialActive ? Math.max(1, Math.ceil((new Date(plan.endsAt) - new Date()) / 86400000)) : 0;

  function enterDemoAccount() {
    setUser(DEMO_USER);
    setAuthMessage('Conta de demonstração ativada. Nenhum login real foi realizado.');
  }

  function leaveDemoAccount() {
    signOutGoogle();
    setUser(null);
    setAuthMessage('Você saiu da conta.');
  }

  async function handleGoogleSignIn() {
    try {
      const googleUser = await signInWithGoogle();
      if (googleUser) {
        setUser(googleUser);
        setAuthMessage('Login com Google realizado.');
      }
    } catch (error) {
      setAuthMessage(error.message || 'Não foi possível entrar com o Google.');
    }
  }

  function activateCopilot() {
    if (!user) setUser(DEMO_USER);
    setPlan({ type: 'pro', demo: true, activatedAt: new Date().toISOString() });
    setAuthMessage('Acesso de demonstração ao Copilot ativado. Nenhuma cobrança foi feita.');
  }

  function startTrial() {
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + 7 * 86400000);
    if (!user) setUser(DEMO_USER);
    setPlan({ type: 'trial', demo: true, startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString() });
    setAuthMessage('Teste de 7 dias ativado para a apresentação. Nenhuma cobrança foi feita.');
  }

  async function exportData() {
    if (exporting) return;
    setExporting(true);
    try {
      const { data, summary } = await createBackup({ records, notes, aiHistory, plan, user, subjectArtifacts, learningPreferences, studyCalendar });
      const shared = await downloadBackup(data);
      const extras = [
        summary.skippedVideos ? `${summary.skippedVideos} vídeo(s) não entram no backup` : '',
        summary.unreadable ? `${summary.unreadable} foto(s) não puderam ser lidas` : '',
        summary.skippedForSize ? `${summary.skippedForSize} foto(s) ficaram de fora pelo limite de tamanho` : '',
      ].filter(Boolean).join('; ');
      setAuthMessage(shared
        ? `Backup pronto: ${notes.length} notas e ${summary.photos} fotos.${extras ? ` ${extras}.` : ''}`
        : 'O compartilhamento não está disponível neste aparelho.');
    } catch {
      setAuthMessage('Não foi possível gerar o backup agora.');
    } finally {
      setExporting(false);
    }
  }

  function updateLearningPreference(key, value) {
    setLearningPreferences({ ...learningPreferences, [key]: value });
    setAuthMessage('Preferências de aprendizagem atualizadas.');
  }

  function connectOutlookDemo() {
    setStudyCalendar(createDemoOutlookCalendar());
    setAuthMessage('Outlook conectado em modo demo. As provas detectadas já entram no plano de estudo.');
  }

  function preparePresentationDemo() {
    setUser(DEMO_USER);
    setPlan({ type: 'pro', demo: true, presentationMode: true, activatedAt: new Date().toISOString() });
    setStudyCalendar(createDemoOutlookCalendar());
    setAuthMessage('Modo apresentação pronto: estudante demo, História e provas do Outlook já estão preparados.');
  }

  // Undoes what "Preparar demo" set up: the demo student and the demo Outlook
  // agenda go too, otherwise Hoje kept greeting Ana and listing fake exams.
  function leavePresentationMode() {
    setPlan({ type: 'free' });
    if (user?.id === DEMO_USER.id) setUser(null);
    if (studyCalendar.account === createDemoOutlookCalendar().account) setStudyCalendar(EMPTY_STUDY_CALENDAR);
    setAuthMessage('Modo apresentação desligado: os painéis mostram só os seus dados.');
  }

  function disconnectOutlookDemo() {
    setStudyCalendar(EMPTY_STUDY_CALENDAR);
    setAuthMessage('Calendário desconectado.');
  }

  async function importData() {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    try {
      const backup = await readBackupFile(picked.assets[0]);
      const confirmed = await confirmAction({
        title: 'Importar backup',
        message: 'Importar este backup vai substituir suas notas, histórico e preferências locais. As fotos serão mescladas. Continuar?',
        confirmLabel: 'Continuar',
      });
      if (!confirmed) return;
      setAuthMessage('Restaurando backup...');
      const result = await restoreLocalData(backup);
      setAuthMessage(`Backup restaurado: ${result.notes} notas e ${result.records} fotos.${result.failedRecords ? ` ${result.failedRecords} foto(s) não vieram no arquivo ou não puderam ser gravadas.` : ''}`);
    } catch (error) {
      setAuthMessage(error.message || 'Não foi possível restaurar esse backup.');
    }
  }

  async function clearData() {
    const confirmed = await confirmAction({
      title: 'Limpar dados locais',
      message: 'Apagar fotos, notas, histórico e preferências deste aparelho? Os exemplos do app voltam ao estado inicial.',
      confirmLabel: 'Apagar',
      destructive: true,
    });
    if (!confirmed) return;
    await clearLocalData();
    setAuthMessage('Dados locais removidos. Os exemplos do app foram restaurados.');
  }

  const planTitle = trialActive
    ? `${daysLeft} dias de teste restantes`
    : plan.type === 'pro'
      ? 'Copilot liberado'
      : 'Estude com mais profundidade';

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10" contentContainerStyle={{ paddingTop: topInset }}>
        <View className="flex-row items-center gap-1.5">
          <Icon name="user" size={13} color="#4f46e5" />
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Seu espaço</Text>
        </View>
        <Text className="-mt-2 text-[24px] font-bold text-slate-900">Perfil</Text>
        <Text className="-mt-3 text-[12px] text-slate-500">Seu painel de estudos agora fica na aba Hoje.</Text>

        <View className="flex-row items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
            {user ? <Text className="text-[14px] font-bold text-indigo-600">{initialsOf(user.name)}</Text> : <Icon name="user" size={19} color="#4f46e5" />}
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-[15px] font-bold text-slate-900">{user ? user.name : 'Conta de demonstração'}</Text>
            <Text className="text-[12px] text-slate-500">{user ? user.email : 'Entre para testar o Copilot da JOVI'}</Text>
          </View>
          {user ? (
            <Pressable accessibilityRole="button" onPress={leaveDemoAccount}><Text className="text-[13px] font-medium text-indigo-600">Sair</Text></Pressable>
          ) : null}
        </View>

        {!user && googleConfigured ? (
          <View className="gap-2 rounded-2xl border border-slate-200 bg-white p-4">
            <Text className="text-[16px] font-bold text-slate-900">Entrar com sua conta Google</Text>
            <Text className="text-[13px] text-slate-600">Sua cota de uso da IA passa a ser controlada pela sua conta em vez do seu endereço na rede.</Text>
            <Pressable accessibilityRole="button" onPress={handleGoogleSignIn} className="mt-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-3">
              <Icon name="user" size={16} color="#334155" />
              <Text className="text-[14px] font-semibold text-slate-700">Entrar com o Google</Text>
            </Pressable>
          </View>
        ) : null}

        {!user ? (
          <View className="gap-2 rounded-2xl border border-slate-200 bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fluxo de apresentação</Text>
              <View className="rounded-full bg-amber-100 px-2 py-1"><Text className="text-[10px] font-bold text-amber-700">DEMO · SEM LOGIN REAL</Text></View>
            </View>
            <Text className="text-[16px] font-bold text-slate-900">Entre para continuar sua trilha</Text>
            <Text className="text-[13px] text-slate-600">Este botão representa um futuro login da conta JOVI. Nesta proposta, tudo acontece localmente para você apresentar o produto sem depender de cadastro externo.</Text>
            <Pressable accessibilityRole="button" onPress={enterDemoAccount} className="mt-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
              <Icon name="user" size={16} color="#ffffff" />
              <Text className="text-[14px] font-semibold text-white">Entrar como estudante</Text>
            </Pressable>
          </View>
        ) : null}

        <View className="gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Modo apresentação</Text>
              <Text className="text-[16px] font-bold text-slate-900">Demo pronta em um toque</Text>
              <Text className="text-[12px] text-slate-600">Ativa a aluna demo, libera o Copilot e conecta as provas do Outlook para mostrar o fluxo completo sem criar nada na hora.</Text>
            </View>
            <Icon name="sparkle" size={18} color="#4f46e5" />
          </View>
          {plan.presentationMode ? (
            <Pressable accessibilityRole="button" onPress={leavePresentationMode} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white py-3">
              <Icon name="close" size={16} color="#4f46e5" />
              <Text className="text-[14px] font-semibold text-indigo-700">Sair do modo apresentação</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={preparePresentationDemo} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
              <Icon name="sparkle" size={16} color="#ffffff" />
              <Text className="text-[14px] font-semibold text-white">Preparar demo</Text>
            </Pressable>
          )}
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">JOVI Copilot</Text>
              <Text className="text-[16px] font-bold text-slate-900">{planTitle}</Text>
            </View>
            <Icon name="crown" size={24} color="#d97706" />
          </View>
          <View className="gap-1.5">
            <BenefitLine text="Análises inteligentes de conteúdo" />
            <BenefitLine text="Trilha Entender · Resolver · Praticar" />
            <BenefitLine text="Histórico e notas para revisão" />
          </View>
          {!trialActive && plan.type !== 'pro' ? (
            <Pressable accessibilityRole="button" onPress={startTrial} className="items-center rounded-xl bg-indigo-600 py-3">
              <Text className="text-[14px] font-semibold text-white">Testar por 7 dias · Demo</Text>
            </Pressable>
          ) : null}
          {plan.type !== 'pro' ? (
            <Pressable accessibilityRole="button" onPress={activateCopilot} className="items-center rounded-xl border border-slate-200 py-3">
              <Text className="text-[14px] font-semibold text-slate-600">Ativar acesso Copilot · Demo</Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
              <Icon name="check" size={15} color="#16a34a" />
              <Text className="text-[13px] font-medium text-emerald-700">Acesso demonstrativo ativo</Text>
            </View>
          )}
          <Text className="text-[11px] text-slate-400">Exemplo de apresentação: não há cobrança, assinatura ou login externo neste fluxo.</Text>
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-slate-900">Seu plano de estudo</Text>
              <Text className="text-[12px] text-slate-500">Usamos essas escolhas nas perguntas, simulados, podcasts, planos e recomendações de vídeo.</Text>
            </View>
            <Icon name="sparkle" size={18} color="#4f46e5" />
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {['Perguntas alinhadas', 'Simulado no foco', 'Vídeos no seu foco'].map((item) => (
              <View key={item} className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1">
                <Text className="text-[11px] font-semibold text-indigo-600">{item}</Text>
              </View>
            ))}
          </View>
          <PreferenceField label="Objetivo principal" options={STUDY_GOAL_OPTIONS} value={learningPreferences.studyGoal} onChange={(v) => updateLearningPreference('studyGoal', v)} />
          <PreferenceField label="Estratégia geral" options={STUDY_CONTEXT_OPTIONS} value={learningPreferences.studyContext} onChange={(v) => updateLearningPreference('studyContext', v)} />
          <PreferenceField label="Ritmo de estudo" options={WEEKLY_PACE_OPTIONS} value={learningPreferences.weeklyPace} onChange={(v) => updateLearningPreference('weeklyPace', v)} />
          <PreferenceField label="Como praticar" options={PRACTICE_MODE_OPTIONS} value={learningPreferences.practiceMode} onChange={(v) => updateLearningPreference('practiceMode', v)} />
          <PreferenceField label="Revisão preferida" options={REVIEW_METHOD_OPTIONS} value={learningPreferences.reviewMethod} onChange={(v) => updateLearningPreference('reviewMethod', v)} />
          <PreferenceField label="Estilo da aula" options={VIDEO_STYLE_OPTIONS} value={learningPreferences.videoStyle} onChange={(v) => updateLearningPreference('videoStyle', v)} />
          <PreferenceField label="Duração preferida" options={DURATION_OPTIONS} value={learningPreferences.duration} onChange={(v) => updateLearningPreference('duration', v)} />
          <PreferenceField label="Nível atual" options={LEVEL_OPTIONS} value={learningPreferences.level} onChange={(v) => updateLearningPreference('level', v)} />
        </View>

        <View className={`gap-3 rounded-2xl border p-4 ${studyCalendar.connected ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-slate-900">Calendário de provas</Text>
              <Text className="text-[12px] text-slate-500">Use o Outlook para ajustar o plano por matéria com datas reais.</Text>
            </View>
            <Icon name="calendar" size={18} color="#4f46e5" />
          </View>
          {studyCalendar.connected ? (
            <>
              <View className="rounded-xl bg-white px-3 py-2">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Outlook conectado</Text>
                <Text className="text-[12px] text-slate-600">{studyCalendar.account}</Text>
              </View>
              <View className="gap-2">
                {studyCalendar.events.slice(0, 3).map((event) => (
                  <View key={event.id} className="rounded-xl border border-indigo-100 bg-white px-3 py-2.5">
                    <Text className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">{event.subject}</Text>
                    <Text className="text-[13px] font-bold text-slate-900">{event.title}</Text>
                    <Text className="text-[11px] text-slate-500">{formatEventDate(event)} · em {daysUntilEvent(event)} dias</Text>
                  </View>
                ))}
              </View>
              <View className="flex-row gap-2">
                <Pressable accessibilityRole="button" onPress={connectOutlookDemo} className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5">
                  <Icon name="rotate" size={14} color="#ffffff" />
                  <Text className="text-[12px] font-semibold text-white">Atualizar</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={disconnectOutlookDemo} className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5">
                  <Icon name="close" size={14} color="#475569" />
                  <Text className="text-[12px] font-semibold text-slate-600">Desconectar</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="text-[13px] leading-5 text-slate-600">Ao conectar, o JOVI detecta eventos de prova e muda a prioridade do plano automaticamente.</Text>
              <Pressable accessibilityRole="button" onPress={connectOutlookDemo} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
                <Icon name="calendar" size={16} color="#ffffff" />
                <Text className="text-[14px] font-semibold text-white">Conectar Outlook · Demo</Text>
              </Pressable>
            </>
          )}
          <Text className="text-[11px] text-slate-400">Demo local: nenhum login Microsoft real é feito nesta versão.</Text>
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-slate-900">Seus dados</Text>
              <Text className="text-[12px] text-slate-500">Faça uma cópia local ou restaure um backup anterior.</Text>
            </View>
            <Icon name="download" size={18} color="#64748b" />
          </View>
          <View className="flex-row gap-2">
            <Pressable accessibilityRole="button" accessibilityState={{ busy: exporting, disabled: exporting }} disabled={exporting} onPress={exportData} className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 ${exporting ? 'opacity-60' : ''}`}>
              <Icon name="download" size={14} color="#475569" />
              <Text className="text-[13px] font-medium text-slate-600">{exporting ? 'Preparando...' : 'Exportar backup'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={importData} className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5">
              <Icon name="upload" size={14} color="#475569" />
              <Text className="text-[13px] font-medium text-slate-600">Importar backup</Text>
            </Pressable>
          </View>
          <Text className="text-[11px] text-slate-400">O arquivo fica no seu dispositivo. A importação mescla mídias pelo identificador e substitui notas, histórico e preferências locais.</Text>
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-slate-900">Privacidade local</Text>
              <Text className="text-[12px] text-slate-500">Remova o conteúdo criado neste aparelho quando quiser.</Text>
            </View>
            <Icon name="lock" size={18} color="#64748b" />
          </View>
          <Pressable accessibilityRole="button" onPress={clearData} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 py-2.5">
            <Icon name="trash" size={14} color="#dc2626" />
            <Text className="text-[13px] font-medium text-red-600">Limpar dados locais</Text>
          </Pressable>
          <Text className="text-[11px] text-slate-400">Essa ação apaga fotos, notas, histórico, plano demonstrativo e artefatos do Estúdio deste dispositivo. Ela não remove os exemplos do app.</Text>
        </View>

      </ScrollView>
      {authMessage ? (
        <View className="absolute left-4 right-4 flex-row items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3" style={{ top: topInset }} accessibilityLiveRegion="polite">
          <Icon name="info" size={15} color="#ffffff" />
          <Text className="flex-1 text-[13px] font-medium text-white">{authMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

function BenefitLine({ text }) {
  return (
    <View className="flex-row items-center gap-2">
      <Icon name="check" size={15} color="#16a34a" />
      <Text className="text-[13px] text-slate-700">{text}</Text>
    </View>
  );
}

function PreferenceField({ label, options, value, onChange }) {
  return (
    <View className="gap-1.5">
      <Text className="text-[12px] font-semibold text-slate-600">{label}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityState={{ selected: active }}
              className={`rounded-full border px-3 py-1.5 ${active ? 'border-indigo-600 bg-indigo-600' : 'border-slate-200 bg-slate-50'}`}
            >
              <Text className={`text-[12px] font-medium ${active ? 'text-white' : 'text-slate-600'}`}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// A crash here stays inside this tab (the tab bar keeps working).
export { default as ErrorBoundary } from '../../components/ErrorScreen.jsx';
