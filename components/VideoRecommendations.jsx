import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import Icon from './Icon.jsx';
import { openExternalUrl } from '../services/links.js';
import { IMAGE_FILL } from '../services/demoAssets.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { findVideoLessons } from '../services/videoRecommendations.js';

function weakTopicsFromExam(examResult) {
  return Object.entries(examResult?.byTopic || {})
    .filter(([, value]) => value.correct < value.total)
    .sort(([, a], [, b]) => (a.correct / a.total) - (b.correct / b.total))
    .map(([topic]) => topic)
    .slice(0, 4);
}

function mergeVideoMetadata(nextVideos = [], previousVideos = []) {
  const previous = new Map(previousVideos.map((video) => [video.id, video]));
  const merged = nextVideos.map((video) => ({ ...video, feedback: previous.get(video.id)?.feedback || null, saved: Boolean(previous.get(video.id)?.saved) }));
  const savedVideos = previousVideos.filter((video) => video.saved && !merged.some((item) => item.id === video.id));
  return [...merged, ...savedVideos].slice(0, 8);
}

export default function VideoRecommendations({ subject, saved = null, examResult = null, onSave }) {
  const { learningPreferences } = useAppData();
  const [result, setResult] = useState(saved || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const weakTopics = weakTopicsFromExam(examResult);

  async function search() {
    setLoading(true);
    setError('');
    try {
      const next = await findVideoLessons({ ...subject, weakTopics: weakTopicsFromExam(examResult) }, learningPreferences);
      next.videos = mergeVideoMetadata(next.videos, result?.videos || saved?.videos || []);
      setResult(next);
      onSave?.(next);
    } catch (err) {
      setError(err.message || 'Não foi possível recomendar uma aula agora.');
    } finally {
      setLoading(false);
    }
  }

  function updateVideo(videoId, patch) {
    if (!result) return;
    const next = { ...result, videos: result.videos.map((video) => (video.id === videoId ? { ...video, ...patch } : video)) };
    setResult(next);
    onSave?.(next);
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon name="search" size={13} color="#4f46e5" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Busca inteligente</Text>
          </View>
          <Text className="text-[16px] font-bold text-slate-900">Aulas em vídeo para {subject.name}</Text>
          <Text className="text-[13px] text-slate-600">A IA sugere buscas e critérios didáticos para você escolher uma aula boa sem depender de API externa de vídeos.</Text>
        </View>
        {result?.mode === 'demo' ? (
          <View className="rounded-full bg-amber-100 px-2 py-1"><Text className="text-[10px] font-bold text-amber-700">DEMO</Text></View>
        ) : null}
      </View>

      {result?.query ? (
        <View className="flex-row items-center gap-1.5">
          <Icon name="sparkle" size={13} color="#4f46e5" />
          <Text className="flex-1 text-[12px] text-slate-600">Busca principal: <Text className="font-semibold text-slate-800">{result.query}</Text></Text>
        </View>
      ) : null}
      {result?.reason ? <Text className="text-[12px] text-slate-500">A seleção {result.reason}.</Text> : null}
      {weakTopics.length ? (
        <View className="flex-row items-start gap-1.5">
          <Icon name="target" size={13} color="#d97706" />
          <Text className="flex-1 text-[12px] text-amber-700">Também priorizando suas dificuldades: <Text className="font-semibold">{weakTopics.join(', ')}</Text></Text>
        </View>
      ) : null}
      {error ? (
        <View className="rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert"><Text className="text-[13px] text-red-600">{error}</Text></View>
      ) : null}

      {!result && !loading ? (
        <Pressable accessibilityRole="button" onPress={search} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3">
          <Icon name="search" size={16} color="#ffffff" />
          <Text className="text-[14px] font-semibold text-white">Recomendar aulas</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View className="flex-row items-center gap-2 py-2">
          <ActivityIndicator color="#4f46e5" />
          <Text className="text-[13px] text-slate-500">Pensando nas melhores buscas para você...</Text>
        </View>
      ) : null}

      {result && !loading ? (
        <View className="gap-3">
          {result.videos?.length ? (
            result.videos.map((video) => (
              <View key={video.id} className="gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                <View className="flex-row gap-3">
                  <View className="h-16 w-20 items-center justify-center overflow-hidden rounded-lg bg-indigo-50">
                    {video.thumbnail ? (
                      <Image source={{ uri: video.thumbnail }} style={IMAGE_FILL} resizeMode="cover" accessibilityIgnoresInvertColors />
                    ) : (
                      <Icon name="search" size={22} color="#4f46e5" />
                    )}
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-[13px] font-bold text-slate-900" numberOfLines={2}>{video.title}</Text>
                    <Text className="text-[11px] text-slate-400">{video.estimatedMinutes ? `${video.estimatedMinutes} min sugeridos` : video.channelTitle}</Text>
                  </View>
                </View>
                <Text className="text-[12px] text-slate-500">{video.description || 'Busca sugerida para esta matéria.'}</Text>
                {video.didacticReason ? <Text className="text-[12px] text-indigo-700">{video.didacticReason}</Text> : null}
                {video.watchFor?.length ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    {video.watchFor.map((item) => (
                      <View key={item} className="rounded-full bg-slate-100 px-2 py-1"><Text className="text-[10px] text-slate-500">{item}</Text></View>
                    ))}
                  </View>
                ) : null}
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-row gap-2">
                    <Pressable accessibilityRole="button" onPress={() => openExternalUrl(video.url)} className="flex-row items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5">
                      <Icon name="play" size={13} color="#ffffff" />
                      <Text className="text-[12px] font-medium text-white">Ir ao vídeo</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => updateVideo(video.id, { saved: !video.saved })} className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${video.saved ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                      <Icon name={video.saved ? 'check' : 'bookmark'} size={13} color={video.saved ? '#4f46e5' : '#475569'} />
                      <Text className={`text-[12px] font-medium ${video.saved ? 'text-indigo-600' : 'text-slate-600'}`}>{video.saved ? 'Na trilha' : 'Salvar'}</Text>
                    </Pressable>
                  </View>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-[11px] text-slate-400">Serviu?</Text>
                  <Pressable
                    onPress={() => updateVideo(video.id, { feedback: video.feedback === 'up' ? null : 'up' })}
                    accessibilityLabel="Recomendação útil"
                    accessibilityState={{ selected: video.feedback === 'up' }}
                    className={`flex-row items-center gap-1 rounded-full px-2 py-1 ${video.feedback === 'up' ? 'bg-emerald-100' : 'bg-slate-100'}`}
                  >
                    <Icon name="check" size={11} color={video.feedback === 'up' ? '#047857' : '#64748b'} />
                    <Text className="text-[11px] text-slate-600">Útil</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => updateVideo(video.id, { feedback: video.feedback === 'down' ? null : 'down' })}
                    accessibilityLabel="Recomendação não serviu"
                    accessibilityState={{ selected: video.feedback === 'down' }}
                    className={`flex-row items-center gap-1 rounded-full px-2 py-1 ${video.feedback === 'down' ? 'bg-red-100' : 'bg-slate-100'}`}
                  >
                    <Icon name="close" size={11} color={video.feedback === 'down' ? '#b91c1c' : '#64748b'} />
                    <Text className="text-[11px] text-slate-600">Não serviu</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <View className="flex-row items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3">
              <Icon name="search" size={18} color="#94a3b8" />
              <Text className="flex-1 text-[13px] text-slate-500">Não encontrei uma busca adequada com esses filtros.</Text>
            </View>
          )}
          <Pressable accessibilityRole="button" onPress={search} className="flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5">
            <Icon name="rotate" size={14} color="#475569" />
            <Text className="text-[13px] font-medium text-slate-600">Recomendar de novo</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
