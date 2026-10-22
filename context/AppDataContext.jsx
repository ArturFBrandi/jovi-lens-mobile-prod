import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteMediaRecord,
  clearMediaRecords,
  getAllMediaRecords,
  getDismissedSeedNotes,
  getHistory,
  getLearningPreferences,
  getNotes,
  getPlan,
  getStudyCalendar,
  getSubjectArtifacts,
  getUser,
  saveMediaRecord,
  setDismissedSeedNotes,
  setHistory as persistHistory,
  setLearningPreferences as persistLearningPreferences,
  setNotes as persistNotes,
  setPlan as persistPlan,
  setStudyCalendar as persistStudyCalendar,
  setSubjectArtifacts as persistSubjectArtifacts,
  setUser as persistUser,
  DEFAULT_LEARNING_PREFERENCES,
} from '../services/storage.js';
import { aggregateSubjects } from '../shared/subjects.js';
import { mergeDemoSubjectArtifacts } from '../shared/demoSubjectArtifacts.js';
import { EMPTY_STUDY_CALENDAR, normalizeStudyCalendar } from '../shared/studyCalendar.js';
import { demoAssetModule } from '../services/demoAssets.js';
import { mergeSeedNotes, sampleMedia, sampleNotes, sampleRecords as samples, studyAssets } from '../shared/seedLibrary.js';

const AppDataContext = createContext(null);

// These paths and the require() keys in services/demoAssets.js are two hand-kept
// lists that must agree. A mismatch degrades silently — the image just falls back
// to an unresolvable `{ uri }` and renders as "Indisponível" — which is the exact
// bug the asset map was added to fix. Fail loudly in development instead.
if (__DEV__) {
  const missing = [...Object.values(studyAssets).flat(), ...sampleMedia.map((sample) => sample.src)]
    .filter((src) => !demoAssetModule(src));
  if (missing.length) {
    console.error(`[JOVI] demo assets sem módulo em services/demoAssets.js: ${missing.join(', ')}`);
  }
}

function getInitialNotes() {
  const stored = getNotes();
  const { notes, changed } = mergeSeedNotes(stored, getDismissedSeedNotes());
  if (changed) persistNotes(notes);
  return notes;
}

function getInitialSubjectArtifacts() {
  const { artifacts, changed } = mergeDemoSubjectArtifacts(getSubjectArtifacts());
  if (changed) persistSubjectArtifacts(artifacts);
  return artifacts;
}

export function AppDataProvider({ children }) {
  const [records, setRecords] = useState(samples);
  const recordsRef = useRef(samples);
  const recordsLoadVersionRef = useRef(0);
  // Records whose first save (file copy + thumbnail + index write) is still in
  // flight. The draft is already visible and tappable during that window, so
  // updates and deletes on it are applied in memory and reconciled by
  // addRecord once the save lands — see addRecord below.
  const persistingRef = useRef(new Set());
  const [notes, setNotesState] = useState(getInitialNotes);
  // Mutations read the latest notes from here, not from a render closure: a
  // save that resolves after an await (or two quick taps) used to write back a
  // stale list and silently drop the other change.
  const notesRef = useRef(notes);
  const [aiHistory, setAiHistory] = useState(() => {
    const stored = getHistory();
    // Older entries embedded the full captured photo (a data: URL) per event —
    // enough of those exhausts the storage quota, which then silently breaks
    // every OTHER write (notes included). Strip any leftover image field once.
    if (!stored.some((entry) => entry.image)) return stored;
    const cleaned = stored.map(({ image, ...rest }) => rest);
    persistHistory(cleaned);
    return cleaned;
  });
  const [plan, setPlanState] = useState(() => getPlan());
  const [user, setUserState] = useState(() => getUser());
  const [subjectArtifacts, setSubjectArtifactsState] = useState(getInitialSubjectArtifacts);
  const [learningPreferences, setLearningPreferencesState] = useState(() => getLearningPreferences());
  const [studyCalendar, setStudyCalendarState] = useState(() => normalizeStudyCalendar(getStudyCalendar() || EMPTY_STUDY_CALENDAR));

  useEffect(() => {
    const loadVersion = recordsLoadVersionRef.current;
    let active = true;
    getAllMediaRecords().then((stored) => {
      if (!active || recordsLoadVersionRef.current !== loadVersion) return;
      const storedIds = new Set(stored.map((record) => record.id));
      const recordsAddedWhileLoading = recordsRef.current.filter((record) => record.source !== 'sample' && !storedIds.has(record.id));
      const next = [...stored, ...recordsAddedWhileLoading, ...samples];
      recordsRef.current = next;
      setRecords(next);
    });
    return () => { active = false; };
  }, []);

  const commitNotes = useCallback((next) => {
    notesRef.current = next;
    setNotesState(next);
    return persistNotes(next);
  }, []);

  const addHistoryEntry = useCallback((entry) => {
    // recordId is enough to resolve the source photo later (NotesTimeline
    // falls back to it via `records`) — embedding the image here is what
    // exhausted the storage quota before.
    const { image, ...rest } = entry;
    const historyEntry = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      ...rest,
    };
    setAiHistory((current) => {
      const next = [historyEntry, ...current].slice(0, 200);
      persistHistory(next);
      return next;
    });
    return historyEntry;
  }, []);

  const replaceRecord = useCallback((record) => {
    recordsRef.current = recordsRef.current.map((item) => item.id === record.id ? record : item);
    setRecords(recordsRef.current);
  }, []);

  const addRecord = useCallback(async ({ src, source = 'upload', label = 'Nova imagem', aiAvailable = true, mediaType = 'image', collectionId = null, pageNumber = null }) => {
    const draft = {
      id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      src,
      source,
      label,
      aiAvailable,
      mediaType,
      collectionId,
      pageNumber,
      createdAt: new Date().toISOString(),
      analysis: null,
    };
    recordsRef.current = [draft, ...recordsRef.current];
    setRecords(recordsRef.current);
    persistingRef.current.add(draft.id);
    // The persisted copy points at the app's own file (and thumbnail); keeping
    // the draft in state would pin a temp/cache path — or a multi-MB data: URI
    // — in memory for the whole session.
    const persisted = await saveMediaRecord(draft);
    persistingRef.current.delete(draft.id);
    if (!persisted) {
      // The copy or the index write failed: take the draft back out rather
      // than leave a tile pointing at a temp file the caller is about to delete.
      recordsRef.current = recordsRef.current.filter((item) => item.id !== draft.id);
      setRecords(recordsRef.current);
      throw new Error('Não foi possível salvar essa mídia no aparelho. Verifique o espaço livre e tente de novo.');
    }
    const current = recordsRef.current.find((item) => item.id === draft.id);
    if (!current) {
      // Deleted while its first save was in flight: that delete found nothing
      // in the index yet, so undo the save here — otherwise the photo came
      // back on the next launch.
      await deleteMediaRecord(draft.id);
      return null;
    }
    // Keep anything patched onto the draft meanwhile (an analysis, a
    // conversation); only the storage fields come from the save.
    const record = { ...current, src: persisted.src, ...(persisted.thumb ? { thumb: persisted.thumb } : {}) };
    replaceRecord(record);
    if (current !== draft && !(await saveMediaRecord(record))) {
      console.warn('[JOVI] não foi possível gravar a atualização da mídia', draft.id);
    }
    // Every new photo/video shows up in Histórico right away, not only after
    // an AI analysis (that adds its own, richer entry).
    addHistoryEntry({
      recordId: record.id,
      title: label,
      type: mediaType === 'video' ? 'Vídeo adicionado' : 'Foto adicionada',
      action: 'capture',
      category: 'Fotos',
      subcategory: source === 'camera' ? 'Câmera' : 'Galeria',
      response: source === 'camera' ? 'Capturada com a câmera e salva na galeria.' : 'Importada e salva na galeria.',
    });
    return record;
  }, [addHistoryEntry, replaceRecord]);

  const updateRecord = useCallback(async (id, patch) => {
    const current = recordsRef.current.find((item) => item.id === id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    replaceRecord(updated);
    // A record still in its first save is persisted (with this patch) by addRecord.
    if (updated.source !== 'sample' && !persistingRef.current.has(id)) await saveMediaRecord(updated);
    return updated;
  }, [replaceRecord]);

  const removeRecord = useCallback(async (record) => {
    if (!record || record.source === 'sample') return false;
    // Out of memory first: an update landing while the files are deleted then
    // finds no record, instead of writing the index entry back.
    const previous = recordsRef.current;
    recordsRef.current = previous.filter((item) => item.id !== record.id);
    setRecords(recordsRef.current);
    if (persistingRef.current.has(record.id) || await deleteMediaRecord(record.id)) return true;
    recordsRef.current = previous;
    setRecords(previous);
    return false;
  }, []);

  // Returns { note, created } — or null when there is nothing to save yet
  // (no analysis) or the write failed. `created: false` means the content is
  // already in Notas (the example note an analysis came from, or an earlier
  // save of this same capture), so the caller can say so instead of claiming
  // a new save.
  const saveNote = useCallback((record) => {
    if (!record?.analysis) return null;
    const current = notesRef.current;
    const source = record.analysis.sourceNoteId ? current.find((item) => item.id === record.analysis.sourceNoteId) : null;
    if (source) return { note: source, created: false };
    const existing = current.find((item) => item.recordId === record.id && !item.seed);
    if (existing) return { note: existing, created: false };
    const subcategory = record.analysis.subcategory || record.analysis.subject || record.analysis.contentType || 'Revisão';
    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recordId: record.id,
      image: record.src,
      images: Array.isArray(record.images) && record.images.length ? record.images : [record.src].filter(Boolean),
      title: record.analysis.title || 'Nota JOVI',
      summary: record.analysis.summary || '',
      keyPoints: record.analysis.keyPoints || [],
      text: record.analysis.text || '',
      category: record.analysis.category || 'Estudos',
      subcategory,
      topicPath: Array.isArray(record.analysis.topicPath) && record.analysis.topicPath.length ? record.analysis.topicPath : [subcategory],
      favorite: false,
      createdAt: new Date().toISOString(),
    };
    // Only commit if the write actually landed — otherwise a failed write
    // leaves the note visible this session but gone on reload.
    const next = [note, ...current];
    if (!persistNotes(next)) return null;
    notesRef.current = next;
    setNotesState(next);
    return { note, created: true };
  }, []);

  const removeNote = useCallback((id) => {
    const target = notesRef.current.find((item) => item.id === id);
    if (target?.seed) setDismissedSeedNotes([...new Set([...getDismissedSeedNotes(), id])]);
    return commitNotes(notesRef.current.filter((item) => item.id !== id));
  }, [commitNotes]);

  const updateNote = useCallback((id, patch) => commitNotes(notesRef.current.map((note) => note.id === id ? { ...note, ...patch } : note)), [commitNotes]);

  const toggleNoteFavorite = useCallback((id) => commitNotes(notesRef.current.map((note) => note.id === id ? { ...note, favorite: !note.favorite } : note)), [commitNotes]);

  const setPlan = useCallback((next) => {
    setPlanState(next);
    persistPlan(next);
  }, []);

  const setUser = useCallback((next) => {
    setUserState(next);
    persistUser(next);
  }, []);

  const setLearningPreferences = useCallback((next) => {
    const preferences = { ...DEFAULT_LEARNING_PREFERENCES, ...(next || {}) };
    setLearningPreferencesState(preferences);
    persistLearningPreferences(preferences);
  }, []);

  const setStudyCalendar = useCallback((next) => {
    const calendar = normalizeStudyCalendar(next || EMPTY_STUDY_CALENDAR);
    setStudyCalendarState(calendar);
    persistStudyCalendar(calendar);
  }, []);

  const restoreLocalData = useCallback(async (backup) => {
    recordsLoadVersionRef.current += 1;
    const incomingRecords = Array.isArray(backup.records) ? backup.records : [];
    // Sequential: each record may decode a multi-MB data: URI to disk.
    let restoredMedia = 0;
    for (const record of incomingRecords) if (await saveMediaRecord(record)) restoredMedia += 1;
    const storedRecords = await getAllMediaRecords();
    const nextRecords = [...storedRecords, ...samples];
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    setDismissedSeedNotes(Array.isArray(backup.dismissedSeedNotes) ? backup.dismissedSeedNotes : []);
    commitNotes(backup.notes || []);
    setAiHistory(backup.aiHistory || []);
    persistHistory(backup.aiHistory || []);
    setPlanState(backup.plan || { type: 'free' });
    persistPlan(backup.plan || { type: 'free' });
    setUserState(backup.user || null);
    persistUser(backup.user || null);
    setSubjectArtifactsState(backup.subjectArtifacts || {});
    persistSubjectArtifacts(backup.subjectArtifacts || {});
    setLearningPreferences(backup.learningPreferences || DEFAULT_LEARNING_PREFERENCES);
    setStudyCalendar(backup.studyCalendar || EMPTY_STUDY_CALENDAR);
    return { records: restoredMedia, failedRecords: incomingRecords.length - restoredMedia + (backup.skippedRecords || 0), notes: (backup.notes || []).length };
  }, [commitNotes, setLearningPreferences, setStudyCalendar]);

  const clearLocalData = useCallback(async () => {
    recordsLoadVersionRef.current += 1;
    await clearMediaRecords();
    recordsRef.current = samples;
    setRecords(samples);
    setDismissedSeedNotes([]);
    commitNotes(sampleNotes);
    setAiHistory([]);
    persistHistory([]);
    setPlanState({ type: 'free' });
    persistPlan({ type: 'free' });
    setUserState(null);
    persistUser(null);
    const { artifacts } = mergeDemoSubjectArtifacts({});
    setSubjectArtifactsState(artifacts);
    persistSubjectArtifacts(artifacts);
    setLearningPreferencesState(DEFAULT_LEARNING_PREFERENCES);
    persistLearningPreferences(DEFAULT_LEARNING_PREFERENCES);
    setStudyCalendarState(EMPTY_STUDY_CALENDAR);
    persistStudyCalendar(EMPTY_STUDY_CALENDAR);
  }, [commitNotes]);

  // Matérias derived from saved notes (category → subthemes + note bodies).
  // Uncategorized notes fall under "Outros", matching how SubjectNotes groups them.
  const subjects = useMemo(() => aggregateSubjects(notes), [notes]);

  // Persists one generated artifact (plan/exam/script/examResult) for a matéria.
  const saveSubjectArtifact = useCallback((subjectName, key, data) => {
    setSubjectArtifactsState((current) => {
      const next = { ...current, [subjectName]: { ...(current[subjectName] || {}), [key]: { data, savedAt: new Date().toISOString() } } };
      persistSubjectArtifacts(next);
      return next;
    });
  }, []);

  const getSubjectArtifact = useCallback((subjectName, key) => subjectArtifacts[subjectName]?.[key] || null, [subjectArtifacts]);

  const value = useMemo(() => ({
    records, notes, aiHistory, plan, user, subjects, subjectArtifacts, learningPreferences, studyCalendar,
    addRecord, updateRecord, removeRecord, saveNote, removeNote, updateNote, toggleNoteFavorite, addHistoryEntry, setPlan, setUser, setLearningPreferences, setStudyCalendar, restoreLocalData, clearLocalData, saveSubjectArtifact, getSubjectArtifact,
  }), [records, notes, aiHistory, plan, user, subjects, subjectArtifacts, learningPreferences, studyCalendar, addRecord, updateRecord, removeRecord, saveNote, removeNote, updateNote, toggleNoteFavorite, addHistoryEntry, setPlan, setUser, setLearningPreferences, setStudyCalendar, restoreLocalData, clearLocalData, saveSubjectArtifact, getSubjectArtifact]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider');
  return value;
}
