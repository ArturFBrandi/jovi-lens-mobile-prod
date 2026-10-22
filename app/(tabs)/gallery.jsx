import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Icon from '../../components/Icon.jsx';
import NotesTimeline from '../../components/NotesTimeline.jsx';
import SmartImageSheet from '../../components/SmartImageSheet.jsx';
import { useTopInset } from '../../hooks/safeArea.js';
import { useToast } from '../../shared/toast.js';
import { IMAGE_FILL, imageSource } from '../../services/demoAssets.js';
import { useAppData } from '../../context/AppDataContext.jsx';

const PAGE_TITLE = { photos: 'Fotos', albums: 'Álbuns', history: 'Histórico' };
const PAGE_KICKER = { photos: 'Galeria', albums: 'Álbum', history: 'Uso da IA' };

// A capture is a document when the scanner took it (page number) or the AI
// read it as text-like content — not when its label happens to contain a word.
const DOCUMENT_TYPES = /exerc|texto|página|pagina|document|livro|anota|slide|prova|lista/i;
function isDocument(record) {
  return Boolean(record.pageNumber || record.collectionId) || DOCUMENT_TYPES.test(record.analysis?.contentType || '');
}

function dayKey(date) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'unknown' : value.toISOString().slice(0, 10);
}

function dayLabel(date) {
  const value = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today)) return 'Hoje';
  if (dayKey(value) === dayKey(yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(value);
}

function groupRecords(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = dayKey(record.createdAt);
    if (!groups.has(key)) groups.set(key, { key, label: dayLabel(record.createdAt), items: [] });
    groups.get(key).items.push(record);
  });
  return [...groups.values()];
}

export default function GalleryScreen() {
  const router = useRouter();
  const { records, notes, aiHistory, addRecord } = useAppData();
  const topInset = useTopInset();
  const [selected, setSelected] = useState(null);
  const [selectedView, setSelectedView] = useState('viewer');
  const [isUploading, setIsUploading] = useState(false);
  const [message, notify] = useToast();
  const [activeTab, setActiveTab] = useState('photos');
  const [activeAlbum, setActiveAlbum] = useState(null);

  const orderedRecords = useMemo(() => [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [records]);
  const recordGroups = useMemo(() => groupRecords(orderedRecords), [orderedRecords]);
  const albums = useMemo(() => {
    // No fallbacks: an album with nothing that actually matches its own
    // criteria should show 0 items, not borrow unrelated photos to look full.
    const camera = orderedRecords.filter((record) => record.source === 'camera');
    const documents = orderedRecords.filter(isDocument);
    const studiedRecordIds = new Set(notes.map((note) => note.recordId));
    const studied = orderedRecords.filter((record) => studiedRecordIds.has(record.id));
    return [
      { id: 'all', title: 'Todas as fotos', subtitle: 'Seu arquivo completo', items: orderedRecords, icon: 'gallery', empty: 'Suas fotos aparecem aqui.' },
      { id: 'camera', title: 'Câmera', subtitle: 'Capturas feitas neste aparelho', items: camera, icon: 'camera', empty: 'Fotos tiradas pela câmera do JOVI Lens aparecem aqui.' },
      { id: 'documents', title: 'Documentos', subtitle: 'Páginas escaneadas e textos lidos pela IA', items: documents, icon: 'note', empty: 'Use o modo DOCUMENTO da câmera ou analise uma página com a IA.' },
      { id: 'studied', title: 'Estudadas', subtitle: 'Fotos que já viraram aprendizado', items: studied, icon: 'sparkle', empty: 'Salve uma análise em Notas para ela aparecer aqui.' },
    ];
  }, [orderedRecords, notes]);
  const pageTitle = PAGE_TITLE[activeTab];
  const pageKicker = PAGE_KICKER[activeTab];

  async function pickImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { notify('Permita o acesso às fotos para importar.'); return; }
    // No base64: addRecord copies each picked file into the app's media folder.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.length) return;
    setIsUploading(true);
    try {
      for (const asset of picked.assets) {
        await addRecord({ src: asset.uri, source: 'upload', label: asset.fileName || 'Imagem importada' });
      }
      notify(`${picked.assets.length} ${picked.assets.length === 1 ? 'imagem adicionada' : 'imagens adicionadas'}`);
    } catch (error) {
      notify(error.message || 'Não foi possível adicionar essa imagem.');
    } finally {
      setIsUploading(false);
    }
  }

  function openRecord(record, view = 'viewer') {
    setSelectedView(view);
    setSelected(record);
  }

  function openAlbum(album) {
    setActiveAlbum(album.id);
  }

  function goTab(tab) {
    setActiveTab(tab);
    setActiveAlbum(null);
  }

  const selectedAlbum = albums.find((album) => album.id === activeAlbum);

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 pb-4" contentContainerStyle={{ paddingTop: topInset }}>
        <View className="gap-3 px-4">
          <View className="flex-row items-start justify-between">
            <View className="gap-1">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">{pageKicker}</Text>
              <Text className="text-[24px] font-bold text-slate-900">{pageTitle}</Text>
            </View>
            <View className="flex-row gap-1.5">
              <HeaderIconButton icon="camera" label="Abrir câmera" onPress={() => router.push('/(tabs)/camera')} />
              <HeaderIconButton icon="note" label="Abrir notas da IA" onPress={() => router.push('/(tabs)/notes')} />
              <HeaderIconButton icon="upload" label="Importar fotos" onPress={pickImages} />
              {/* "Mais opções" was removed here: it showed the toast "Organização
                  inteligente ativada" and did nothing at all. Announcing success for
                  an action that does not exist is worse than not offering it. Wire a
                  real menu back in when there is something for it to open. */}
            </View>
          </View>
          <View className="flex-row gap-2 rounded-full bg-slate-100 p-1" accessibilityRole="tablist" accessibilityLabel="Seções da galeria">
            <SegmentButton label="Fotos" active={activeTab === 'photos'} onPress={() => goTab('photos')} />
            <SegmentButton label="Álbuns" active={activeTab === 'albums'} onPress={() => goTab('albums')} />
            <SegmentButton label="Histórico" active={activeTab === 'history'} onPress={() => goTab('history')} />
          </View>
        </View>

        <View className="px-4">
          {activeTab === 'photos' ? (
            <PhotosView groups={recordGroups} isUploading={isUploading} onImport={pickImages} onOpen={openRecord} />
          ) : null}
          {activeTab === 'albums' ? (
            selectedAlbum ? (
              <AlbumDetail album={selectedAlbum} onBack={() => setActiveAlbum(null)} onOpen={openRecord} />
            ) : (
              <AlbumsView albums={albums} onOpen={openAlbum} />
            )
          ) : null}
          {activeTab === 'history' ? (
            <NotesTimeline notes={notes} aiHistory={aiHistory} records={orderedRecords} onOpen={openRecord} />
          ) : null}
        </View>
      </ScrollView>

      {message ? (
        <View className="absolute bottom-24 left-4 right-4 flex-row items-center justify-center gap-2 rounded-full bg-slate-900/90 px-4 py-2.5">
          <Icon name={isUploading ? 'sparkle' : 'check'} size={15} color="#ffffff" />
          <Text className="text-[13px] font-medium text-white">{message}</Text>
        </View>
      ) : null}
      {selected ? (
        <SmartImageSheet
          record={{ ...selected, ...(records.find((item) => item.id === selected.id) || {}) }}
          initialView={selectedView}
          onClose={() => { setSelected(null); setSelectedView('viewer'); }}
        />
      ) : null}
    </View>
  );
}

function HeaderIconButton({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} className="h-9 w-9 items-center justify-center rounded-full bg-slate-100">
      <Icon name={icon} size={18} color="#475569" />
    </Pressable>
  );
}

function SegmentButton({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className={`flex-1 items-center rounded-full py-2 ${active ? 'bg-white' : ''}`}
    >
      <Text className={`text-[13px] font-medium ${active ? 'text-slate-900' : 'text-slate-500'}`}>{label}</Text>
    </Pressable>
  );
}

function PhotosView({ groups, isUploading, onImport, onOpen }) {
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-[15px] font-bold text-slate-900">Recentes</Text>
          <Text className="text-[12px] text-slate-500">O seu mural de fotos</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onImport} disabled={isUploading} className="flex-row items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5">
          <Icon name="upload" size={15} color="#475569" />
          <Text className="text-[12px] font-medium text-slate-600">{isUploading ? 'Importando' : 'Importar'}</Text>
        </Pressable>
      </View>
      {groups.map((group) => (
        <View key={group.key} className="gap-2">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-[13px] font-bold text-slate-900">{group.label}</Text>
            <Text className="text-[11px] text-slate-400">{group.items.length} {group.items.length === 1 ? 'item' : 'itens'}</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {group.items.map((record) => <PhotoTile key={record.id} record={record} onOpen={onOpen} />)}
          </View>
        </View>
      ))}
      {!groups.length ? (
        <View className="items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-6 py-10">
          <Icon name="camera" size={20} color="#94a3b8" />
          <Text className="text-[13px] text-slate-500">Suas próximas fotos aparecem aqui.</Text>
        </View>
      ) : null}
    </View>
  );
}

function PhotoTile({ record, onOpen }) {
  return (
    <Pressable onPress={() => onOpen(record)} accessibilityRole="imagebutton" accessibilityLabel={`Abrir ${record.label || 'foto'}${record.analysis ? ', já estudada' : ''}`} className="relative h-28 w-[31%] overflow-hidden rounded-xl bg-slate-100">
      <MediaThumb record={record} />
      {record.pageNumber ? (
        <View className="absolute bottom-1 left-1 flex-row items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5">
          <Icon name="scan" size={10} color="#ffffff" />
          <Text className="text-[9px] font-medium text-white">P{record.pageNumber}</Text>
        </View>
      ) : record.mediaType === 'video' ? (
        <View className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1"><Icon name="play" size={10} color="#ffffff" /></View>
      ) : record.analysis ? (
        <View className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1"><Icon name="sparkle" size={10} color="#ffffff" /></View>
      ) : null}
    </Pressable>
  );
}

function MediaThumb({ record }) {
  const [failed, setFailed] = useState(false);
  if (!record?.src || failed) {
    return (
      <View className="h-full w-full items-center justify-center gap-1">
        <Icon name={record?.mediaType === 'video' ? 'play' : 'image'} size={18} color="#94a3b8" />
        <Text className="text-[9px] text-slate-400">Indisponível</Text>
      </View>
    );
  }
  // The saved thumbnail when there is one; resizeMethod="resize" makes Android
  // decode at tile size instead of full resolution for anything older.
  return <Image source={imageSource(record.thumb || record.src)} accessibilityIgnoresInvertColors onError={() => setFailed(true)} style={IMAGE_FILL} resizeMode="cover" resizeMethod="resize" />;
}

function AlbumsView({ albums, onOpen }) {
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-[15px] font-bold text-slate-900">Álbuns</Text>
          <Text className="text-[12px] text-slate-500">Organizados no seu JOVI</Text>
        </View>
      </View>
      <View className="gap-2">
        {albums.map((album) => (
          <Pressable accessibilityRole="button" key={album.id} onPress={() => onOpen(album)} className="flex-row items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
              {album.items[0] ? <MediaThumb record={album.items[0]} /> : <Icon name={album.icon} size={22} color="#94a3b8" />}
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-[14px] font-bold text-slate-900">{album.title}</Text>
              <Text className="text-[12px] text-slate-500">{album.items.length} itens</Text>
            </View>
            <Icon name="chevron" size={16} color="#94a3b8" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AlbumDetail({ album, onBack, onOpen }) {
  return (
    <View className="gap-4">
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar para álbuns" onPress={onBack} className="flex-row items-center gap-1 self-start">
        <View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="chevron" size={17} color="#4f46e5" strokeWidth={2.4} /></View>
        <Text className="text-[13px] font-medium text-indigo-600">Álbuns</Text>
      </Pressable>
      <View>
        <Text className="text-[16px] font-bold text-slate-900">{album.title}</Text>
        <Text className="text-[12px] text-slate-500">{album.items.length} itens</Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {album.items.map((record) => <PhotoTile key={record.id} record={record} onOpen={onOpen} />)}
      </View>
      {!album.items.length ? (
        <View className="items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-6 py-10">
          <Icon name={album.icon} size={20} color="#94a3b8" />
          <Text className="text-center text-[13px] text-slate-500">{album.empty}</Text>
        </View>
      ) : null}
    </View>
  );
}

// A crash here stays inside this tab (the tab bar keeps working).
export { default as ErrorBoundary } from '../../components/ErrorScreen.jsx';
