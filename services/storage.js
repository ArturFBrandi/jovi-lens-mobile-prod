import { Image, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { createMMKV } from 'react-native-mmkv';
import { isSafeDataUri, ownMediaPath, rebaseMediaPath } from '../shared/mediaPaths.js';

// Same key/value interface as the web app's services/storage.js (backed by
// localStorage + IndexedDB there). MMKV is used instead of AsyncStorage
// because it's synchronous, like localStorage — that lets every getX()/setX()
// below keep the exact same synchronous signature, so context/AppDataContext.jsx
// ports with no async refactor. It's a native module either way (not available
// in Expo Go), which this project already accepts for the camera/dictation
// libraries — see react-native-migration-plan.md.

const storage = createMMKV({ id: 'jovi-lens' });

const NOTES_KEY = 'jovi_mobile_notes_v2';
const HISTORY_KEY = 'jovi_mobile_ai_history_v1';
const PLAN_KEY = 'jovi_mobile_plan_v1';
const USER_KEY = 'jovi_mobile_user_v1';
const SESSION_KEY = 'jovi_mobile_session_v1';
const SUBJECT_KEY = 'jovi_mobile_subject_artifacts_v1';
const LEARNING_PREFERENCES_KEY = 'jovi_mobile_learning_preferences_v1';
const STUDY_CALENDAR_KEY = 'jovi_mobile_study_calendar_v1';
const MEDIA_INDEX_KEY = 'jovi_mobile_media_index_v1';
const DISMISSED_SEEDS_KEY = 'jovi_mobile_dismissed_seed_notes_v1';

// The browser preview has no app document directory; media stays in memory there.
const PERSIST_FILES = Platform.OS !== 'web' && Boolean(FileSystem.documentDirectory);
const THUMB_WIDTH = 360;

export const MEDIA_DIR = `${FileSystem.documentDirectory}jovi-media/`;

export async function ensureMediaDirExists() {
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
}

export const DEFAULT_LEARNING_PREFERENCES = {
  studyGoal: 'vestibular',
  studyContext: 'classes',
  weeklyPace: 'regular',
  practiceMode: 'mixed',
  reviewMethod: 'spaced',
  videoStyle: 'animated',
  duration: 'standard',
  level: 'intermediate',
};

function readJson(key, fallback) {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Guarded writer, mirroring the web version's contract: callers doing an
// optimistic state update (e.g. saveNote) can tell a real success from a
// silent failure (disk full, MMKV unavailable) via the boolean return.
function writeJson(key, value) {
  try {
    storage.set(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function extensionForMediaType(mediaType) {
  return mediaType === 'video' ? 'mp4' : 'jpg';
}

// Media paths are stored absolute, but the app's container path is not stable:
// iOS can move it on an app update, and a backup restored on another phone
// carries that phone's path. rebaseMediaPath re-anchors a stored `file:` path
// on the CURRENT media folder by its file name — and only a plain media file
// name; ownMediaPath gates every read and delete (see shared/mediaPaths.js).
export function rebaseMediaUri(uri) {
  return PERSIST_FILES ? rebaseMediaPath(uri, MEDIA_DIR) : uri;
}

function rebaseRecord(record) {
  if (!record) return record;
  const src = rebaseMediaUri(record.src);
  const thumb = rebaseMediaUri(record.thumb);
  return src === record.src && thumb === record.thumb ? record : { ...record, src, ...(record.thumb ? { thumb } : {}) };
}

// Gallery tiles are ~112dp; decoding a 12 MP original for each one is what
// makes a long gallery stutter and balloon memory. A small JPEG next to the
// original is cheap to make once, at save time.
async function makeThumbnail(uri, id) {
  try {
    const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: THUMB_WIDTH } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
    const target = `${MEDIA_DIR}${id}-thumb.jpg`;
    // moveAsync fails on iOS when the target exists (a restore over data from
    // the same device), which lost the thumbnail and orphaned the old file.
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: result.uri, to: target });
    return target;
  } catch {
    return null;
  }
}

// Stored photos are capped at this long side. A picked 48 MP original kept at
// full size costs ~10 MB of disk per photo and made backups too large to
// import back; 2560px is still sharper than any screen the app draws on and
// plenty for the vision model (which receives 1600px).
const MAX_STORED_SIDE = 2560;

async function capResolution(uri) {
  const { width, height } = await new Promise((resolve, reject) => { Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject); });
  if (Math.max(width, height) <= MAX_STORED_SIDE) return null;
  const resize = width >= height ? { width: MAX_STORED_SIDE } : { height: MAX_STORED_SIDE };
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize }], { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG });
  return result.uri;
}

// Brings any incoming media into the app's own directory: a data: URI
// (backup restore, web-shaped payloads) is decoded to a file; a file:// or
// content:// URI outside MEDIA_DIR (camera temp file, picker cache — both of
// which the OS may purge) is copied in, downscaled first when it is huge.
// Bundled samples and http URLs pass through untouched. Throws on failure.
async function persistMediaFile(input) {
  if (!PERSIST_FILES || !input?.src) return input;
  // data: is decoded first and never re-anchored: a crafted "data:…/jovi-media/.."
  // must not turn into a file path.
  const record = input.src.startsWith('data:') ? input : rebaseRecord(input);
  await ensureMediaDirExists();
  const path = `${MEDIA_DIR}${record.id}.${extensionForMediaType(record.mediaType)}`;
  if (!ownMediaPath(path, MEDIA_DIR)) throw new Error('Identificador de mídia inválido.');
  let persisted = record;
  if (record.src.startsWith('data:')) {
    if (!isSafeDataUri(record.src)) throw new Error('Formato de mídia inválido.');
    const match = /^data:([^;]+);base64,(.*)$/s.exec(record.src);
    await FileSystem.writeAsStringAsync(path, match[2], { encoding: FileSystem.EncodingType.Base64 });
    persisted = { ...record, src: path };
  } else if (record.mediaType === 'video' && ownMediaPath(record.src, MEDIA_DIR) && record.src !== path) {
    // The recorder writes straight into the media folder under its own name;
    // renaming to <id>.mp4 keeps "one file per record", so a delete can never
    // reach another record's file.
    await FileSystem.moveAsync({ from: record.src, to: path });
    persisted = { ...record, src: path };
  } else if (/^(file|content):/.test(record.src) && !record.src.startsWith(MEDIA_DIR)) {
    const reduced = record.mediaType === 'video' ? null : await capResolution(record.src).catch(() => null);
    await FileSystem.deleteAsync(path, { idempotent: true });
    if (reduced) await FileSystem.moveAsync({ from: reduced, to: path });
    else await FileSystem.copyAsync({ from: record.src, to: path });
    persisted = { ...record, src: path };
  }
  if (persisted.mediaType !== 'video' && persisted.src.startsWith(MEDIA_DIR) && !persisted.thumb) {
    const thumb = await makeThumbnail(persisted.src, record.id);
    if (thumb) persisted = { ...persisted, thumb };
  }
  return persisted;
}

async function deleteMediaFile(src) {
  const target = ownMediaPath(rebaseMediaUri(src), MEDIA_DIR);
  if (!target) return;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
  } catch {
    // A leftover file only costs disk space; the index entry is what matters.
  }
}

function readMediaIndex() {
  return readJson(MEDIA_INDEX_KEY, []);
}

function writeMediaIndex(records) {
  return writeJson(MEDIA_INDEX_KEY, records);
}

export async function getAllMediaRecords() {
  try {
    const stored = readMediaIndex().map(rebaseRecord);
    return [...stored].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {
    return [];
  }
}

// Saves for the same record run one after another: an analysis merge and a
// conversation update fired back to back used to race through the (slow)
// file/thumbnail step and land out of order, the older object winning.
const saveQueues = new Map();

// Returns the persisted record, or null when the file or index write failed —
// callers surface that instead of announcing a save that did not happen.
export function saveMediaRecord(record) {
  const previous = saveQueues.get(record.id) || Promise.resolve();
  const run = previous.then(async () => {
    try {
      // Browser preview: no media folder, and MMKV is localStorage (~5 MB) —
      // a data: photo there filled the quota and broke every other write.
      if (!PERSIST_FILES && String(record.src || '').startsWith('data:')) return record;
      const persisted = await persistMediaFile(record);
      const index = readMediaIndex();
      if (!writeMediaIndex([persisted, ...index.filter((item) => item.id !== persisted.id)])) return null;
      return persisted;
    } catch {
      return null;
    }
  });
  const tail = run.finally(() => { if (saveQueues.get(record.id) === tail) saveQueues.delete(record.id); });
  saveQueues.set(record.id, tail);
  return run;
}

// Returns whether the record is gone from the index — the caller surfaces a
// failure instead of closing the viewer as if the photo had been deleted. A
// leftover file is only disk space, so file errors don't fail the delete.
export async function deleteMediaRecord(id) {
  // Runs after any save still queued for this record — otherwise that save
  // wrote the index entry back after the delete, leaving a broken tile.
  await (saveQueues.get(id) || Promise.resolve());
  try {
    const index = readMediaIndex();
    const target = index.find((item) => item.id === id);
    if (!writeMediaIndex(index.filter((item) => item.id !== id))) return false;
    if (target) await Promise.all([deleteMediaFile(target.src), deleteMediaFile(target.thumb)]);
    return true;
  } catch {
    return false;
  }
}

export async function clearMediaRecords() {
  try {
    const index = readMediaIndex();
    await Promise.all(index.flatMap((item) => [deleteMediaFile(item.src), deleteMediaFile(item.thumb)]));
    writeMediaIndex([]);
  } catch {
    // Ignore storage failures in prototype mode.
  }
}

// Reads a persisted media file back as a data: URI (for the portable backup).
// Returns null for anything that is not an app-owned file it could read, so the
// backup counts it as unreadable instead of exporting a dead device path.
export async function readMediaAsDataUri(record) {
  const src = ownMediaPath(rebaseMediaUri(record?.src), MEDIA_DIR);
  if (!PERSIST_FILES || !src) return null;
  try {
    const base64 = await FileSystem.readAsStringAsync(src, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${record.mediaType === 'video' ? 'video/mp4' : 'image/jpeg'};base64,${base64}`;
  } catch {
    return null;
  }
}

export const getNotes = () => readJson(NOTES_KEY, []);
// Seed (example) notes the student deleted. Without this list the next launch
// re-added every missing example, so deleting one never stuck.
export const getDismissedSeedNotes = () => readJson(DISMISSED_SEEDS_KEY, []);
export const setDismissedSeedNotes = (ids) => writeJson(DISMISSED_SEEDS_KEY, ids);
export const setNotes = (notes) => writeJson(NOTES_KEY, notes);
export const getHistory = () => readJson(HISTORY_KEY, []);
export const setHistory = (history) => writeJson(HISTORY_KEY, history);
export const getPlan = () => readJson(PLAN_KEY, { type: 'free' });
export const setPlan = (plan) => writeJson(PLAN_KEY, plan);
export const getUser = () => readJson(USER_KEY, null);
export const setUser = (user) => {
  try {
    if (user) storage.set(USER_KEY, JSON.stringify(user));
    else storage.delete(USER_KEY);
  } catch {
    // storage unavailable
  }
};

// Kept out of `user` (and therefore out of createBackup's export) on purpose —
// this is a live credential, not profile data that should end up in a backup
// file someone might share. See services/googleAuth.js and services/apiClient.js.
export const getSessionToken = () => {
  try {
    return storage.getString(SESSION_KEY) || null;
  } catch {
    return null;
  }
};
export const setSessionToken = (token) => {
  try {
    if (token) storage.set(SESSION_KEY, token);
    else storage.delete(SESSION_KEY);
  } catch {
    // storage unavailable
  }
};

// Subject artifacts: generated plan/exam/scripts + last exam result, keyed by matéria.
export const getSubjectArtifacts = () => readJson(SUBJECT_KEY, {});
export const setSubjectArtifacts = (artifacts) => writeJson(SUBJECT_KEY, artifacts);
export const getLearningPreferences = () => ({ ...DEFAULT_LEARNING_PREFERENCES, ...readJson(LEARNING_PREFERENCES_KEY, {}) });
export const setLearningPreferences = (preferences) => writeJson(LEARNING_PREFERENCES_KEY, { ...DEFAULT_LEARNING_PREFERENCES, ...preferences });
export const getStudyCalendar = () => readJson(STUDY_CALENDAR_KEY, null);
export const setStudyCalendar = (calendar) => writeJson(STUDY_CALENDAR_KEY, calendar || null);
