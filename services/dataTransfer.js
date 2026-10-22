import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { demoAssetModule } from './demoAssets.js';
import { getDismissedSeedNotes, readMediaAsDataUri } from './storage.js';
import { isSafeDataUri } from '../shared/mediaPaths.js';

const BACKUP_VERSION = 1;
const MAX_IMPORT_BYTES = 120 * 1024 * 1024;
// Export stops embedding photos below the import ceiling (with room for the
// notes/history JSON): a backup the app then refuses to import is worse than
// one that says up front which photos did not fit.
const MAX_EXPORT_MEDIA_CHARS = 100 * 1024 * 1024;

// Records live on this device as file:// paths — exporting those paths (what
// the backup used to do) restored every photo as "Imagem indisponível" on
// another phone or after a reinstall. Photos are embedded as data: URIs so the
// file is self-contained; videos are left out (a few of them would push the
// JSON past what the import can safely hold in memory) and reported instead.
export async function createBackup({ records = [], notes = [], aiHistory = [], plan = { type: 'free' }, user = null, subjectArtifacts = {}, learningPreferences = {}, studyCalendar = null } = {}) {
  const own = records.filter((record) => record?.source !== 'sample');
  const portable = [];
  let skippedVideos = 0;
  let unreadable = 0;
  let skippedForSize = 0;
  let mediaChars = 0;
  for (const record of own) {
    if (record.mediaType === 'video') { skippedVideos += 1; continue; }
    if (mediaChars >= MAX_EXPORT_MEDIA_CHARS) { skippedForSize += 1; continue; }
    const src = await readMediaAsDataUri(record);
    if (!src) { unreadable += 1; continue; }
    if (mediaChars + src.length > MAX_EXPORT_MEDIA_CHARS) { skippedForSize += 1; continue; }
    mediaChars += src.length;
    const { thumb, ...rest } = record; // regenerated on restore
    portable.push({ ...rest, src });
  }
  return {
    data: {
      app: 'jovi-lens',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      records: portable,
      notes,
      dismissedSeedNotes: getDismissedSeedNotes(),
      aiHistory,
      plan,
      user,
      subjectArtifacts,
      learningPreferences,
      studyCalendar,
    },
    summary: { photos: portable.length, skippedVideos, unreadable, skippedForSize },
  };
}

// Web downloads via a Blob + synthetic <a download> click — there's no RN
// equivalent of a browser download. Instead: write the JSON to a local file
// and hand it off through the OS share sheet (Save to Files, Drive, email...).
// Returns whether the share sheet was actually offered.
export async function downloadBackup(data) {
  const filename = `jovi-lens-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Salvar backup do JOVI Lens' });
  return true;
}

function listOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Media sources a restore may write to disk: embedded data (the backup's own
// format) or a bundled example that exists in this build. Anything else — an
// absolute path from another device, or a remote URL that would make the
// phone contact the backup author's server on every render — is dropped.
function isRestorableSrc(src) {
  return isSafeDataUri(src) || demoAssetModule(src) !== null;
}

// Images a restored note may reference: its embedded/bundled media or an app
// media path (re-anchored on read). A remote URL would make the phone fetch
// from the backup author's server every time the note opens.
function isRestorableImageRef(value) {
  return isRestorableSrc(value) || (typeof value === 'string' && value.startsWith('file:') && value.includes('/jovi-media/'));
}

function sanitizeNote(note) {
  const images = Array.isArray(note.images) ? note.images.filter(isRestorableImageRef) : [];
  return { ...note, image: isRestorableImageRef(note.image) ? note.image : images[0] || null, images };
}

// Video thumbnails in the Estúdio come from YouTube; anything else is dropped.
function sanitizeArtifacts(artifacts) {
  const next = {};
  for (const [subject, entries] of Object.entries(artifacts)) {
    if (!isObject(entries)) continue;
    const copy = { ...entries };
    const videos = copy.videoRecommendations?.data?.videos;
    if (Array.isArray(videos)) {
      copy.videoRecommendations = {
        ...copy.videoRecommendations,
        data: { ...copy.videoRecommendations.data, videos: videos.map((video) => ({ ...video, thumbnail: /^https:\/\/i\.ytimg\.com\//.test(video?.thumbnail || '') ? video.thumbnail : '' })) },
      };
    }
    next[subject] = copy;
  }
  return next;
}

// Ids become file names (`<id>.jpg`, `<id>-thumb.jpg`): word characters only
// (no path traversal), and never a `-thumb` suffix that would alias another
// record's thumbnail file.
function isSafeRecordId(id) {
  // Also never "video-…": that is the recorder's own file-name prefix.
  return typeof id === 'string' && /^[\w-]{1,80}$/.test(id) && !/-thumb$/i.test(id) && !/^video-/i.test(id);
}

// `file` is an expo-document-picker asset ({ uri, size, name, mimeType }),
// not a web File — the caller picks it via DocumentPicker.getDocumentAsync().
export async function readBackupFile(file) {
  if (!file?.uri || (file.size && file.size > MAX_IMPORT_BYTES)) throw new Error('Esse backup é grande demais para importar.');
  // Some pickers report no size — check the file itself before reading it in.
  const info = await FileSystem.getInfoAsync(file.uri).catch(() => null);
  if (info?.size && info.size > MAX_IMPORT_BYTES) throw new Error('Esse backup é grande demais para importar.');
  let data;
  try {
    data = JSON.parse(await FileSystem.readAsStringAsync(file.uri));
  } catch {
    throw new Error('O arquivo selecionado não é um backup JSON válido.');
  }
  if (data?.app !== 'jovi-lens' || data?.version !== BACKUP_VERSION) throw new Error('Backup incompatível com esta versão do JOVI Lens.');
  const incoming = listOrEmpty(data.records);
  const records = incoming
    .filter((record) => isObject(record) && isSafeRecordId(record.id) && isRestorableSrc(record.src))
    .map(({ thumb, ...record }) => record);
  return {
    records,
    // Old backups carried device file paths instead of the photos themselves.
    skippedRecords: incoming.length - records.length,
    // Notes feed straight into list rendering; a malformed one (no id/title)
    // would crash Notas, so only well-formed notes come back.
    notes: listOrEmpty(data.notes).filter((note) => isObject(note) && typeof note.id === 'string' && typeof note.title === 'string').map(sanitizeNote),
    dismissedSeedNotes: listOrEmpty(data.dismissedSeedNotes).filter((id) => typeof id === 'string'),
    aiHistory: listOrEmpty(data.aiHistory).filter(isObject),
    plan: isObject(data.plan) ? data.plan : { type: 'free' },
    user: isObject(data.user) ? data.user : null,
    subjectArtifacts: isObject(data.subjectArtifacts) ? sanitizeArtifacts(data.subjectArtifacts) : {},
    learningPreferences: isObject(data.learningPreferences) ? data.learningPreferences : {},
    studyCalendar: isObject(data.studyCalendar) ? data.studyCalendar : null,
  };
}
