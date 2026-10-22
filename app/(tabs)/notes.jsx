import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import Icon from '../../components/Icon.jsx';
import SubjectNotes from '../../components/SubjectNotes.jsx';
import SubjectStudio from '../../components/SubjectStudio.jsx';
import SmartImageSheet from '../../components/SmartImageSheet.jsx';
import LibrarySearch from '../../components/LibrarySearch.jsx';
import NoteEditor from '../../components/NoteEditor.jsx';
import { useTopInset } from '../../hooks/safeArea.js';
import { useAppData } from '../../context/AppDataContext.jsx';
import { confirmAction } from '../../services/confirm.js';

export default function NotesScreen() {
  const { notes, aiHistory, records, subjects, removeNote, updateNote, toggleNoteFavorite } = useAppData();
  const topInset = useTopInset();
  const [selected, setSelected] = useState(null);
  const [selectedView, setSelectedView] = useState('viewer');
  const [studioSubject, setStudioSubject] = useState(null);
  const [editing, setEditing] = useState(null);
  const [studioTab, setStudioTab] = useState('overview');
  // Deep link from Hoje (/notes?subject=História&studio=questions&t=…) opens
  // that matéria's Estúdio on the right tab. Each link is consumed once (the
  // `t` stamp makes every tap distinct), so coming back to Notas later does
  // not reopen it. Clearing the params instead crashed a cold deep link:
  // setParams runs before the root navigator has mounted.
  const params = useLocalSearchParams();
  const consumedLinkRef = useRef('');
  useEffect(() => {
    const name = typeof params.subject === 'string' ? params.subject : '';
    const linkKey = `${name}|${params.studio || ''}|${params.t || ''}`;
    if (!name || consumedLinkRef.current === linkKey) return;
    const target = subjects.find((subject) => subject.name === name);
    if (!target) return;
    consumedLinkRef.current = linkKey;
    setStudioTab(typeof params.studio === 'string' ? params.studio : 'overview');
    setStudioSubject(target);
  }, [params.subject, params.studio, params.t, subjects]);

  function openRecord(record, view = 'viewer') {
    setSelectedView(view);
    setSelected(record);
  }

  // Deleting a note used to happen on the first tap, with no undo.
  async function confirmRemove(id) {
    const note = notes.find((item) => item.id === id);
    const confirmed = await confirmAction({
      title: 'Excluir esta nota?',
      message: `"${note?.title || 'Nota'}" sai da sua biblioteca. A foto de origem continua na galeria.`,
      confirmLabel: 'Excluir',
      destructive: true,
    });
    if (confirmed) removeNote(id);
  }

  function openStudio(subjectName) {
    setStudioTab('overview');
    setStudioSubject(subjects.find((subject) => subject.name === subjectName) || null);
  }

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10" contentContainerStyle={{ paddingTop: topInset }}>
        <View className="flex-row items-center justify-between">
          <View className="gap-1">
            <View className="flex-row items-center gap-1.5">
              <Icon name="note" size={13} color="#4f46e5" />
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Memória da IA</Text>
            </View>
            <Text className="text-[24px] font-bold text-slate-900">Notas</Text>
          </View>
          <View className="items-end">
            <Text className="text-[20px] font-bold text-slate-900">{notes.length}</Text>
            <Text className="text-[11px] text-slate-400">salvas</Text>
          </View>
        </View>
        <LibrarySearch notes={notes} aiHistory={aiHistory} records={records} onOpen={openRecord} />
        <SubjectNotes
          notes={notes}
          records={records}
          onOpen={openRecord}
          onOpenStudio={openStudio}
          onFavorite={toggleNoteFavorite}
          onRemove={confirmRemove}
          onEdit={setEditing}
        />
      </ScrollView>
      {selected ? (
        <SmartImageSheet
          record={{ ...selected, ...(records.find((item) => item.id === selected.id) || {}) }}
          initialView={selectedView}
          onClose={() => { setSelected(null); setSelectedView('viewer'); }}
        />
      ) : null}
      {studioSubject ? <SubjectStudio key={`${studioSubject.name}-${studioTab}`} subject={studioSubject} initialTab={studioTab} onClose={() => setStudioSubject(null)} /> : null}
      {editing ? (
        <NoteEditor
          note={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => { updateNote(editing.id, next); setEditing(null); }}
        />
      ) : null}
    </View>
  );
}

// A crash here stays inside this tab (the tab bar keeps working).
export { default as ErrorBoundary } from '../../components/ErrorScreen.jsx';
