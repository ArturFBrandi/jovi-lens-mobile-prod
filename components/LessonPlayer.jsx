import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Icon from './Icon.jsx';
import { generateSubjectContent } from '../services/subjectStudy.js';
import { narration } from '../services/audio.js';

// videoExport.js (client-side canvas+MediaRecorder slideshow render, and the
// "Exportar vídeo (.webm)" button that used it) is dropped for the RN app —
// see react-native-migration-plan.md's Tier 3 decision. This screen is a
// narrated slide lesson, without generated-video dependencies.

export default function LessonPlayer({ subject, saved, onSave }) {
  const [phase, setPhase] = useState(saved ? 'ready' : 'idle');
  const [script, setScript] = useState(saved || null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('idle'); // idle | intro | slides
  const [playing, setPlaying] = useState({ index: 0, state: 'idle' });
  const titleTimerRef = useRef(null);
  const mountedRef = useRef(true);

  const beginNarration = useCallback(() => {
    if (!script?.slides?.length) return;
    setMode('slides');
    narration.start(
      script.slides.map((slide) => ({ speaker: 'narrator', text: slide.narration || slide.heading })),
      {
        onUpdate: (update) => setPlaying({ index: update.superseded ? 0 : update.index, state: update.superseded ? 'idle' : update.state }),
        onEnd: () => { setPlaying({ index: 0, state: 'idle' }); setMode('idle'); },
      },
    );
  }, [script]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; narration.stop(); clearTimeout(titleTimerRef.current); };
  }, []);

  // Drive the title card once mode enters 'intro'.
  useEffect(() => {
    if (mode !== 'intro') return undefined;
    let cancelled = false;
    const advance = () => { if (!cancelled) beginNarration(); };
    titleTimerRef.current = setTimeout(advance, 3400);
    return () => { cancelled = true; clearTimeout(titleTimerRef.current); };
  }, [beginNarration, mode]);

  async function generate() {
    setPhase('loading');
    setError('');
    narration.stop();
    clearTimeout(titleTimerRef.current);
    setMode('idle');
    setPlaying({ index: 0, state: 'idle' });
    try {
      const result = await generateSubjectContent(subject, { action: 'lesson-script' });
      if (!mountedRef.current) return;
      if (!result.slides?.length) throw new Error('Não foi possível montar a aula agora.');
      setScript(result);
      setPhase('ready');
      onSave?.(result);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message || 'Falha ao gerar a aula.');
      setPhase('idle');
    }
  }

  // The [mode] effect handles title-card timing before narration starts.
  function play() {
    if (!script?.slides?.length) return;
    setPlaying({ index: 0, state: 'playing' });
    setMode('intro');
  }

  function stopAll() {
    clearTimeout(titleTimerRef.current);
    narration.stop();
    setMode('idle');
    setPlaying({ index: 0, state: 'idle' });
  }

  if (phase === 'loading') {
    return (
      <View className="flex-row items-center gap-2 py-4">
        <ActivityIndicator color="#4f46e5" />
        <Text className="text-[13px] text-slate-500">Preparando sua vídeo aula de {subject.name}...</Text>
      </View>
    );
  }

  if (!script) {
    return (
      <View className="gap-3">
        <View className="gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon name="film" size={13} color="#4f46e5" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Vídeo aula</Text>
          </View>
          <Text className="text-[16px] font-bold text-slate-900">Aula personalizada de {subject.name}</Text>
          <Text className="text-[13px] text-slate-600">Slides narrados a partir das suas notas, com title card e tópicos para acompanhar sem depender de vídeo gerado.</Text>
        </View>
        {error ? <View className="rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert"><Text className="text-[13px] text-red-600">{error}</Text></View> : null}
        <Pressable accessibilityRole="button" onPress={generate} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
          <Icon name="film" size={16} color="#ffffff" />
          <Text className="text-[14px] font-semibold text-white">Gerar vídeo aula</Text>
        </Pressable>
      </View>
    );
  }

  const slide = script.slides[Math.max(0, playing.index)] || script.slides[0];
  const isPlaying = playing.state === 'playing';
  const isPaused = playing.state === 'paused';
  return (
    <View className="gap-4">
      <View className="min-h-52 justify-center overflow-hidden rounded-2xl bg-slate-900">
        {mode === 'intro' ? (
          <View className="items-center gap-1 px-6 py-14">
            <Text className="text-[11px] font-bold tracking-widest text-indigo-300">AULA</Text>
            <Text className="text-center text-[19px] font-bold text-white">{script.title}</Text>
            <Text className="text-[13px] text-slate-400">{subject.name}</Text>
          </View>
        ) : null}
        {mode !== 'intro' ? (
          <View className="gap-2 px-5 py-6" accessibilityLiveRegion="polite">
            <Text className="text-[11px] text-indigo-300">Slide {Math.max(0, playing.index) + 1} / {script.slides.length}</Text>
            <Text className="text-[18px] font-bold text-white">{slide.heading}</Text>
            <View className="gap-1">
              {(slide.bullets || []).map((bullet, i) => (
                <Text key={i} className="text-[13px] text-slate-200">• {bullet}</Text>
              ))}
            </View>
            {(isPlaying || isPaused) && slide.narration ? (
              <Text className="mt-1 text-[12px] italic text-slate-400">{slide.narration}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <View className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${((Math.max(0, playing.index) + 1) / script.slides.length) * 100}%` }} />
      </View>

      <View className="flex-row items-center gap-3">
        {mode === 'intro' ? (
          <View className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-slate-200 py-3">
            <Icon name="film" size={20} color="#64748b" />
            <Text className="text-[14px] font-semibold text-slate-500">Introdução…</Text>
          </View>
        ) : isPlaying ? (
          <Pressable accessibilityRole="button" onPress={() => narration.pause()} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3">
            <Icon name="pause" size={20} color="#ffffff" />
            <Text className="text-[14px] font-semibold text-white">Pausar</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => (isPaused ? narration.resume() : play())} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3">
            <Icon name="play" size={20} color="#ffffff" />
            <Text className="text-[14px] font-semibold text-white">{isPaused ? 'Retomar' : 'Assistir aula'}</Text>
          </Pressable>
        )}
        {mode !== 'idle' ? (
          <Pressable onPress={stopAll} accessibilityLabel="Parar" className="h-12 w-12 items-center justify-center rounded-xl border border-slate-200">
            <Icon name="stop" size={18} color="#475569" />
          </Pressable>
        ) : null}
      </View>

      <Pressable accessibilityRole="button" onPress={generate} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5">
        <Icon name="rotate" size={14} color="#475569" />
        <Text className="text-[13px] font-medium text-slate-600">Gerar nova aula</Text>
      </Pressable>
    </View>
  );
}
