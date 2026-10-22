import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Icon from './Icon.jsx';
import { generateSubjectContent } from '../services/subjectStudy.js';
import { narration } from '../services/audio.js';
import { useAppData } from '../context/AppDataContext.jsx';

// Spoken Portuguese runs ~150 words a minute; the estimate is what a student
// sees, so it has to match the audio (the seeded pitch episode claims 10 min
// for ~1 min of speech, which is kept only in presentation mode).
function estimateMinutes(segments = []) {
  const words = segments.reduce((sum, segment) => sum + String(segment.text || '').split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round(words / 150));
}

const SPEAKER_LABEL = { A: 'Ana', B: 'Especialista', narrator: 'Narrador', coach: 'IA', feedback: 'Feedback' };
const FORMAT_LABEL = {
  dialogue: 'Conversa · 2 vozes',
  single: 'Episódio · narrador',
  drive: 'No carro · mãos livres',
};

export default function PodcastPlayer({ subject, saved, savedVariants = null, onSave }) {
  const initialFormat = saved?.format || (savedVariants?.dialogue ? 'dialogue' : Object.keys(savedVariants || {})[0]) || 'dialogue';
  const [format, setFormat] = useState(initialFormat);
  const [script, setScript] = useState(savedVariants?.[initialFormat] || saved || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { plan } = useAppData();
  const [playback, setPlayback] = useState({ index: -1, state: 'idle', mode: null, waiting: false });
  const [coachAnswers, setCoachAnswers] = useState({});

  useEffect(() => () => narration.stop(), []);

  async function generate(nextFormat = format) {
    setLoading(true);
    setError('');
    narration.stop();
    setPlayback({ index: -1, state: 'idle', mode: null, waiting: false });
    try {
      const generated = await generateSubjectContent(subject, { action: 'podcast-script', format: nextFormat });
      if (!generated.segments?.length) throw new Error('Não foi possível gerar o roteiro agora.');
      // Cached under the format that was asked for, whatever the model claims.
      const result = { ...generated, format: nextFormat };
      setScript(result);
      setCoachAnswers({});
      onSave?.(result);
    } catch (err) {
      setError(err.message || 'Falha ao gerar o podcast.');
    } finally {
      setLoading(false);
    }
  }

  // Switching format shows that format's saved episode, or the "Gerar" screen
  // for it — it used to start a paid generation on its own, and overwrite the
  // episode of the other format.
  function chooseFormat(next) {
    if (next === format) return;
    narration.stop();
    setPlayback({ index: -1, state: 'idle', mode: null, waiting: false });
    setFormat(next);
    setScript(savedVariants?.[next] || ((saved?.format || 'dialogue') === next ? saved : null));
    setCoachAnswers({});
    setError('');
  }

  function playFrom(index = 0) {
    if (!script?.segments?.length) return;
    narration.start(script.segments, {
      onUpdate: (u) => setPlayback({ index: u.index, state: u.state, mode: u.mode, waiting: Boolean(u.waiting) }),
      onEnd: () => setPlayback({ index: -1, state: 'idle', mode: null, waiting: false }),
    }, index);
  }

  const isPlaying = playback.state === 'playing';
  const isPaused = playback.state === 'paused';
  const currentIndex = playback.index >= 0 ? playback.index : 0;
  const currentLabel = script?.segments?.length ? `Trecho ${currentIndex + 1} de ${script.segments.length}` : '';

  if (loading) {
    return (
      <View className="flex-row items-center gap-2 py-4">
        <ActivityIndicator color="#4f46e5" />
        <Text className="text-[13px] text-slate-500">Gravando seu podcast de {subject.name}...</Text>
      </View>
    );
  }

  if (!script) {
    return (
      <View className="gap-3">
        <View className="gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon name="waveform" size={13} color="#4f46e5" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Podcast da matéria</Text>
          </View>
          <Text className="text-[16px] font-bold text-slate-900">Ouça {subject.name} em áudio</Text>
          <Text className="text-[13px] text-slate-600">Transformamos suas notas em episódio. O modo No carro organiza a revisão para ouvir sem olhar para a tela.</Text>
        </View>
        <FormatChooser format={format} onChoose={chooseFormat} />
        {error ? <View className="rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert"><Text className="text-[13px] text-red-600">{error}</Text></View> : null}
        <Pressable accessibilityRole="button" onPress={() => generate()} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
          <Icon name="waveform" size={16} color="#ffffff" />
          <Text className="text-[14px] font-semibold text-white">Gerar podcast</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-3 rounded-2xl bg-indigo-50 p-3">
        <View className="h-14 w-14 items-center justify-center rounded-xl bg-indigo-600">
          <Icon name="waveform" size={26} color="#ffffff" />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-[11px] text-indigo-500">{FORMAT_LABEL[script.format || format] || FORMAT_LABEL.dialogue}</Text>
          <Text className="text-[15px] font-bold text-slate-900" numberOfLines={2}>{script.title}</Text>
          <Text className="text-[11px] text-slate-500">Aprox. {plan?.presentationMode && script.durationMinutes ? script.durationMinutes : estimateMinutes(script.segments)} min</Text>
        </View>
      </View>

      {script.format === 'drive' ? (
        <View className="gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
          <View className="flex-row items-center gap-1.5">
            <Icon name="route" size={13} color="#4f46e5" />
            <Text className="text-[12px] font-semibold text-indigo-700">Modo carro</Text>
          </View>
          <Text className="text-[13px] leading-5 text-slate-700">A IA conversa com você, faz perguntas da matéria e dá feedback para a resposta escolhida.</Text>
          {currentLabel ? <Text className="text-[12px] text-slate-500">{currentLabel}</Text> : null}
          {playback.waiting ? (
            <View className="flex-row items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5" accessibilityLiveRegion="polite">
              <Icon name="mic" size={13} color="#4f46e5" />
              <Text className="text-[12px] font-semibold text-indigo-700">Sua vez: responda em voz alta</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <FormatChooser format={format} onChoose={chooseFormat} />

      <View className="flex-row items-center gap-3">
        {isPlaying ? (
          <Pressable accessibilityRole="button" onPress={() => narration.pause()} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3">
            <Icon name="pause" size={20} color="#ffffff" />
            <Text className="text-[14px] font-semibold text-white">Pausar</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => (isPaused ? narration.resume() : playFrom(0))} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3">
            <Icon name="play" size={20} color="#ffffff" />
            <Text className="text-[14px] font-semibold text-white">{isPaused ? 'Retomar' : 'Reproduzir'}</Text>
          </Pressable>
        )}
        {isPlaying || isPaused ? (
          <Pressable
            onPress={() => { narration.stop(); setPlayback({ index: -1, state: 'idle', mode: null, waiting: false }); }}
            accessibilityLabel="Parar"
            className="h-12 w-12 items-center justify-center rounded-xl border border-slate-200"
          >
            <Icon name="stop" size={18} color="#475569" />
          </Pressable>
        ) : null}
      </View>
      {script.format === 'drive' && script.segments.length > 1 ? (
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => playFrom(Math.max(0, currentIndex - 1))}
            className="flex-1 items-center rounded-xl border border-slate-200 py-2.5"
          >
            <Text className="text-[12px] font-medium text-slate-600">Trecho anterior</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            // During "Sua vez" the index already points at the feedback that
            // follows the question — "next" must not skip it.
            onPress={() => playFrom(Math.min(script.segments.length - 1, playback.waiting ? currentIndex : currentIndex + 1))}
            className="flex-1 items-center rounded-xl border border-slate-200 py-2.5"
          >
            <Text className="text-[12px] font-medium text-slate-600">Próximo trecho</Text>
          </Pressable>
        </View>
      ) : null}
      {playback.mode === 'browser' && (isPlaying || isPaused) ? (
        <View className="flex-row items-center gap-1.5">
          <Icon name="info" size={12} color="#94a3b8" />
          <Text className="text-[11px] text-slate-400">Narração pela voz do dispositivo.</Text>
        </View>
      ) : null}

      {script.format === 'drive' ? (
        <DriveCoach
          script={script}
          answers={coachAnswers}
          onAnswer={(id, value) => setCoachAnswers((current) => ({ ...current, [id]: value }))}
        />
      ) : null}

      <View className="gap-2">
        {script.segments.map((segment, index) => {
          const active = playback.index === index;
          return (
            <Pressable
              accessibilityRole="button"
              key={index}
              onPress={() => playFrom(index)}
              className={`gap-1 rounded-xl border px-3 py-2.5 ${active ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'} ${segment.speaker === 'B' ? 'ml-6' : ''}`}
            >
              <Text className="text-[11px] font-semibold text-indigo-500">{SPEAKER_LABEL[segment.speaker] || 'Narrador'}</Text>
              <Text className="text-[13px] leading-5 text-slate-700">{segment.text}</Text>
            </Pressable>
          );
        })}
      </View>

      {script.takeaways?.length ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-1.5">
            <Icon name="bookmark" size={13} color="#64748b" />
            <Text className="text-[12px] font-semibold text-slate-500">Para lembrar depois</Text>
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {script.takeaways.map((item) => (
              <View key={item} className="rounded-full bg-slate-100 px-2.5 py-1">
                <Text className="text-[11px] text-slate-500">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => generate()} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5">
        <Icon name="rotate" size={14} color="#475569" />
        <Text className="text-[13px] font-medium text-slate-600">Gerar novo episódio</Text>
      </Pressable>
    </View>
  );
}

function DriveCoach({ script, answers, onAnswer }) {
  const interactions = Array.isArray(script.interactions) ? script.interactions : [];
  if (!interactions.length) return null;

  return (
    <View className="gap-3 rounded-2xl bg-slate-950 p-3">
      <View className="gap-1">
        <View className="flex-row items-center gap-1.5">
          <Icon name="sparkle" size={13} color="#bef264" />
          <Text className="text-[12px] font-semibold text-lime-200">Bate-papo com IA</Text>
        </View>
        <Text className="text-[12px] leading-4 text-slate-300">Para quando o carro estiver parado: toque na opção para ver o feedback. Dirigindo, use só o áudio.</Text>
      </View>
      {interactions.map((item, index) => {
        const selectedId = answers[item.id];
        const selected = item.options?.find((option) => option.id === selectedId);
        return (
          <View key={item.id || item.prompt} className="gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-lime-200">{String(index + 1).padStart(2, '0')} · {item.topic}</Text>
            <Text className="text-[14px] font-semibold leading-5 text-white">{item.prompt}</Text>
            <View className="gap-2">
              {(item.options || []).map((option) => {
                const active = selectedId === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => onAnswer(item.id, option.id)}
                    className={`rounded-xl border px-3 py-2.5 ${active ? 'border-lime-300 bg-lime-300' : 'border-white/10 bg-white/10'}`}
                  >
                    <Text className={`text-[12px] font-medium leading-4 ${active ? 'text-slate-950' : 'text-slate-100'}`}>{option.text}</Text>
                  </Pressable>
                );
              })}
            </View>
            {selected ? (
              <View className={`flex-row gap-1.5 rounded-xl px-3 py-2 ${selected.correct ? 'bg-emerald-500/15' : 'bg-amber-400/15'}`}>
                <Icon name={selected.correct ? 'check' : 'info'} size={13} color={selected.correct ? '#6ee7b7' : '#fcd34d'} />
                <Text className={`flex-1 text-[12px] leading-4 ${selected.correct ? 'text-emerald-100' : 'text-amber-100'}`}>
                  {selected.correct ? item.feedbackCorrect : item.feedbackWrong}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function FormatChooser({ format, onChoose }) {
  return (
    <View className="flex-row gap-2" accessibilityRole="tablist" accessibilityLabel="Formato do podcast">
      <Pressable
        onPress={() => onChoose('dialogue')}
        accessibilityRole="tab"
        accessibilityState={{ selected: format === 'dialogue' }}
        className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 ${format === 'dialogue' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-200 bg-white'}`}
      >
        <Icon name="user" size={14} color={format === 'dialogue' ? '#ffffff' : '#475569'} />
        <Text className={`text-[13px] font-medium ${format === 'dialogue' ? 'text-white' : 'text-slate-600'}`}>Dois apresentadores</Text>
      </Pressable>
      <Pressable
        onPress={() => onChoose('single')}
        accessibilityRole="tab"
        accessibilityState={{ selected: format === 'single' }}
        className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 ${format === 'single' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-200 bg-white'}`}
      >
        <Icon name="mic" size={14} color={format === 'single' ? '#ffffff' : '#475569'} />
        <Text className={`text-[13px] font-medium ${format === 'single' ? 'text-white' : 'text-slate-600'}`}>Narrador único</Text>
      </Pressable>
      <Pressable
        onPress={() => onChoose('drive')}
        accessibilityRole="tab"
        accessibilityState={{ selected: format === 'drive' }}
        className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 ${format === 'drive' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-200 bg-white'}`}
      >
        <Icon name="route" size={14} color={format === 'drive' ? '#ffffff' : '#475569'} />
        <Text className={`text-[13px] font-medium ${format === 'drive' ? 'text-white' : 'text-slate-600'}`}>No carro</Text>
      </Pressable>
    </View>
  );
}
