import Database from "better-sqlite3";
import type {
  BibleBook,
  BibleDisplaySettings,
  BackgroundState,
  BibleVerse,
  BibleVersion,
  ChurchSettings,
  DisplaySettings,
  MediaItem,
  Meeting,
  MeetingItem,
  Song,
  SongCategory,
  SongDisplaySettings,
  SavedAlert,
} from "../shared/types.js";
import {
  initialBibleDisplaySettings,
  initialChurchSettings,
  initialDisplaySettings,
  initialProjectionState,
  initialSongDisplaySettings,
} from "../shared/types.js";

const foldBibleSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A small, bounded Levenshtein check lets "misericordia" also find a
// misspelled "misericordea", without turning the Bible search into a slow full
// text engine. It is only used for words of four or more characters.
const areSimilarWords = (left: string, right: string) => {
  if (left === right || left.includes(right) || right.includes(left)) return true;
  if (left.length < 4 || right.length < 4 || Math.abs(left.length - right.length) > 2)
    return false;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = saved;
    }
  }
  return previous[right.length] <= (left.length >= 8 ? 2 : 1);
};

export class AppDatabase {
  private db: Database.Database;
  private bibleSearchRows = new Map<
    number,
    Array<BibleVerse & { bookOrder: number; folded: string; words: string[] }>
  >();

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        favorite_slot INTEGER UNIQUE CHECK(favorite_slot BETWEEN 1 AND 10)
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS song_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category_id INTEGER REFERENCES song_categories(id) ON DELETE SET NULL,
        content TEXT NOT NULL DEFAULT '', section_types TEXT NOT NULL DEFAULT '[]', color TEXT NOT NULL DEFAULT '#8b5cf6', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS bible_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'es', enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS bible_verses (
        version_id INTEGER NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE, book TEXT NOT NULL, book_order INTEGER NOT NULL,
        chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(version_id, book, chapter, verse)
      );
      CREATE INDEX IF NOT EXISTS idx_bible_reference ON bible_verses(version_id, book_order, chapter, verse);
      CREATE TABLE IF NOT EXISTS meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#665cff', date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS meeting_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#665cff', payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const songColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(songs)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!songColumns.has("shadow_enabled"))
      this.db.exec(
        "ALTER TABLE songs ADD COLUMN shadow_enabled INTEGER NOT NULL DEFAULT 1",
      );
    if (!songColumns.has("shadow_color"))
      this.db.exec(
        "ALTER TABLE songs ADD COLUMN shadow_color TEXT NOT NULL DEFAULT '#000000'",
      );
    if (!songColumns.has("shadow_blur"))
      this.db.exec(
        "ALTER TABLE songs ADD COLUMN shadow_blur INTEGER NOT NULL DEFAULT 14",
      );
    if (!songColumns.has("color"))
      this.db.exec(
        "ALTER TABLE songs ADD COLUMN color TEXT NOT NULL DEFAULT '#8b5cf6'",
      );
    if (!songColumns.has("section_types"))
      this.db.exec(
        "ALTER TABLE songs ADD COLUMN section_types TEXT NOT NULL DEFAULT '[]'",
      );
    const meetingColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(meetings)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!meetingColumns.has("color"))
      this.db.exec(
        "ALTER TABLE meetings ADD COLUMN color TEXT NOT NULL DEFAULT '#665cff'",
      );
    const bibleVersionColumns = new Set(
      (this.db.prepare("PRAGMA table_info(bible_versions)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!bibleVersionColumns.has("enabled"))
      this.db.exec("ALTER TABLE bible_versions ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }

  syncMedia(paths: string[]) {
    const found = new Set(paths);
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO media(path, name) VALUES (?, ?)",
    );
    const remove = this.db.prepare("DELETE FROM media WHERE path = ?");
    const current = this.db.prepare("SELECT path FROM media").all() as {
      path: string;
    }[];
    const tx = this.db.transaction(() => {
      for (const path of paths)
        insert.run(path, path.split(/[\\/]/).pop() ?? path);
      for (const row of current) if (!found.has(row.path)) remove.run(row.path);
    });
    tx();
  }

  listMedia(toUrl: (path: string) => string): MediaItem[] {
    const rows = this.db
      .prepare("SELECT * FROM media ORDER BY name COLLATE NOCASE")
      .all() as Array<{
      id: number;
      path: string;
      name: string;
      tags: string;
      favorite_slot: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      url: toUrl(row.path),
      tags: JSON.parse(row.tags),
      favoriteSlot: row.favorite_slot,
      kind: /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(row.path)
        ? "image"
        : "video",
    }));
  }

  setFavorite(id: number, slot: number | null) {
    const tx = this.db.transaction(() => {
      if (slot)
        this.db
          .prepare(
            "UPDATE media SET favorite_slot = NULL WHERE favorite_slot = ?",
          )
          .run(slot);
      this.db
        .prepare("UPDATE media SET favorite_slot = ? WHERE id = ?")
        .run(slot, id);
    });
    tx();
  }

  setTags(id: number, tags: string[]) {
    this.db
      .prepare("UPDATE media SET tags = ? WHERE id = ?")
      .run(JSON.stringify(tags), id);
  }
  updateMediaDetails(id: number, name: string, tags: string[]) {
    this.db
      .prepare("UPDATE media SET name = ?, tags = ? WHERE id = ?")
      .run(name.trim(), JSON.stringify(tags), id);
  }
  getMediaPath(id: number) {
    return (
      (
        this.db.prepare("SELECT path FROM media WHERE id=?").get(id) as
          | { path: string }
          | undefined
      )?.path ?? null
    );
  }

  listCategories(): SongCategory[] {
    return this.db
      .prepare(
        "SELECT c.id, c.name, COUNT(s.id) songCount FROM song_categories c LEFT JOIN songs s ON s.category_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE",
      )
      .all() as SongCategory[];
  }
  createCategory(name: string) {
    return Number(
      this.db
        .prepare("INSERT INTO song_categories(name) VALUES (?)")
        .run(name.trim()).lastInsertRowid,
    );
  }
  listSongs(search = "", categoryId?: number | null): Song[] {
    const filter = `%${search}%`;
    const rows = this.db
      .prepare(
        `SELECT s.id,s.title,s.color,s.category_id categoryId,c.name categoryName,s.content,s.section_types sectionTypes,s.shadow_enabled shadowEnabled,s.shadow_color shadowColor,s.shadow_blur shadowBlur,s.created_at createdAt,s.updated_at updatedAt FROM songs s LEFT JOIN song_categories c ON c.id=s.category_id WHERE (s.title LIKE ? OR s.content LIKE ?) AND (? IS NULL OR s.category_id=?) ORDER BY s.title COLLATE NOCASE`,
      )
      .all(filter, filter, categoryId ?? null, categoryId ?? null) as Array<
      Omit<Song, "shadowEnabled" | "sectionTypes"> & {
        shadowEnabled: number;
        sectionTypes: string;
      }
    >;
    return rows.map((row) => ({
      ...row,
      shadowEnabled: Boolean(row.shadowEnabled),
      sectionTypes: (() => {
        try {
          const parsed = JSON.parse(row.sectionTypes);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
    }));
  }
  saveSong(song: Partial<Song> & { title: string; content: string }) {
    const shadowEnabled = song.shadowEnabled === false ? 0 : 1,
      shadowColor = song.shadowColor || "#000000",
      shadowBlur = Math.max(0, Math.min(40, Number(song.shadowBlur ?? 14))),
      color = song.color || "#8b5cf6",
      sectionTypes = JSON.stringify(song.sectionTypes || []);
    if (song.id) {
      this.db
        .prepare(
          "UPDATE songs SET title=?,color=?,category_id=?,content=?,section_types=?,shadow_enabled=?,shadow_color=?,shadow_blur=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(
          song.title,
          color,
          song.categoryId ?? null,
          song.content,
          sectionTypes,
          shadowEnabled,
          shadowColor,
          shadowBlur,
          song.id,
        );
      return song.id;
    }
    return Number(
      this.db
        .prepare(
          "INSERT INTO songs(title,color,category_id,content,section_types,shadow_enabled,shadow_color,shadow_blur) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          song.title,
          color,
          song.categoryId ?? null,
          song.content,
          sectionTypes,
          shadowEnabled,
          shadowColor,
          shadowBlur,
        ).lastInsertRowid,
    );
  }
  deleteSong(id: number) {
    this.db.prepare("DELETE FROM songs WHERE id=?").run(id);
  }

  seedBible(
    code: string,
    name: string,
    data: Record<string, Record<string, Record<string, string>>>,
  ) {
    if (this.db.prepare("SELECT 1 FROM bible_versions WHERE code=?").get(code))
      return;
    const tx = this.db.transaction(() => {
      const versionId = Number(
        this.db
          .prepare("INSERT INTO bible_versions(code,name) VALUES (?,?)")
          .run(code, name).lastInsertRowid,
      );
      const insert = this.db.prepare(
        "INSERT INTO bible_verses(version_id,book,book_order,chapter,verse,text) VALUES (?,?,?,?,?,?)",
      );
      Object.entries(data).forEach(([book, chapters], bookOrder) =>
        Object.entries(chapters).forEach(([chapter, verses]) =>
          Object.entries(verses).forEach(([verse, text]) =>
            insert.run(
              versionId,
              book,
              bookOrder + 1,
              Number(chapter),
              Number(verse),
              text,
            ),
          ),
        ),
      );
    });
    tx();
    this.bibleSearchRows.clear();
  }
  hasBibleVersion(code: string) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM bible_versions WHERE code=?").get(code),
    );
  }
  listBibleVersions(enabledOnly = false): BibleVersion[] {
    const rows = this.db
      .prepare(`SELECT id,code,name,language,enabled FROM bible_versions ${enabledOnly ? "WHERE enabled=1" : ""} ORDER BY name`)
      .all() as Array<Omit<BibleVersion, "enabled"> & { enabled: number }>;
    return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }
  setBibleVersionEnabled(id: number, enabled: boolean) {
    this.db.prepare("UPDATE bible_versions SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id);
  }
  listBibleBooks(versionId: number): BibleBook[] {
    return this.db
      .prepare(
        "SELECT book,MAX(chapter) chapters FROM bible_verses WHERE version_id=? GROUP BY book ORDER BY MIN(book_order)",
      )
      .all(versionId) as BibleBook[];
  }
  listBibleVerses(
    versionId: number,
    book: string,
    chapter: number,
  ): BibleVerse[] {
    return this.db
      .prepare(
        "SELECT book,chapter,verse,text FROM bible_verses WHERE version_id=? AND book=? AND chapter=? ORDER BY verse",
      )
      .all(versionId, book, chapter) as BibleVerse[];
  }
  searchBible(versionId: number, search: string): BibleVerse[] {
    const phrase = foldBibleSearch(search);
    const terms = phrase.split(" ").filter((term) => term.length >= 2).slice(0, 8);
    if (!terms.length) return [];

    let rows = this.bibleSearchRows.get(versionId);
    if (!rows) {
      rows = (
        this.db
          .prepare(
            "SELECT book,book_order bookOrder,chapter,verse,text FROM bible_verses WHERE version_id=?",
          )
          .all(versionId) as Array<BibleVerse & { bookOrder: number }>
      ).map((verse) => {
        const folded = foldBibleSearch(verse.text);
        return { ...verse, folded, words: folded.split(" ") };
      });
      this.bibleSearchRows.set(versionId, rows);
    }

    return rows
      .map((verse) => {
        let score = verse.folded.includes(phrase) ? 120 : 0;
        let matches = 0;
        for (const term of terms) {
          if (verse.folded.includes(term)) {
            matches += 1;
            score += 24;
          } else if (verse.words.some((word) => areSimilarWords(term, word))) {
            matches += 1;
            score += 9;
          }
        }
        return { verse, score, matches };
      })
      .filter(({ matches }) => matches === terms.length)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.verse.bookOrder - right.verse.bookOrder ||
          left.verse.chapter - right.verse.chapter ||
          left.verse.verse - right.verse.verse,
      )
      .slice(0, 100)
      .map(({ verse }) => ({
        book: verse.book,
        chapter: verse.chapter,
        verse: verse.verse,
        text: verse.text,
      }));
  }

  getDisplaySettings(): DisplaySettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='display'")
      .get() as { value: string } | undefined;
    return row
      ? { ...initialDisplaySettings, ...JSON.parse(row.value) }
      : initialDisplaySettings;
  }
  saveDisplaySettings(settings: DisplaySettings) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('display',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
  }
  getChurchSettings(): ChurchSettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='church'")
      .get() as { value: string } | undefined;
    return row
      ? { ...initialChurchSettings, ...JSON.parse(row.value) }
      : initialChurchSettings;
  }
  saveChurchSettings(settings: ChurchSettings) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('church',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
  }
  getBibleDisplaySettings(): BibleDisplaySettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='bible-display'")
      .get() as { value: string } | undefined;
    if (!row) return initialBibleDisplaySettings;
    const saved = {
      ...initialBibleDisplaySettings,
      ...JSON.parse(row.value),
    } as BibleDisplaySettings;
    return {
      ...saved,
      longVerseMode:
        saved.longVerseMode === "split" ? "split-halves" : saved.longVerseMode,
    };
  }
  saveBibleDisplaySettings(settings: BibleDisplaySettings) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('bible-display',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
  }
  getSongDisplaySettings(): SongDisplaySettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='song-display'")
      .get() as { value: string } | undefined;
    return row
      ? { ...initialSongDisplaySettings, ...JSON.parse(row.value) }
      : initialSongDisplaySettings;
  }
  saveSongDisplaySettings(settings: SongDisplaySettings) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('song-display',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
  }
  getLastBackground(): BackgroundState | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='last-background'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    try {
      return {
        ...initialProjectionState.background,
        ...JSON.parse(row.value),
      } as BackgroundState;
    } catch {
      return null;
    }
  }
  saveLastBackground(background: BackgroundState) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('last-background',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(background));
  }
  getSavedAlerts(): SavedAlert[] {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='saved-alerts'")
      .get() as { value: string } | undefined;
    if (!row) return [];
    try {
      const saved = JSON.parse(row.value);
      return Array.isArray(saved) ? saved.filter((item): item is SavedAlert =>
        item && typeof item.id === "string" && typeof item.message === "string",
      ) : [];
    } catch {
      return [];
    }
  }
  saveSavedAlerts(alerts: SavedAlert[]) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('saved-alerts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(alerts));
  }
  getCollaboratorCode() {
    return (
      (this.db
        .prepare("SELECT value FROM settings WHERE key='collaborator-code'")
        .get() as { value: string } | undefined)?.value ?? ""
    );
  }
  saveCollaboratorCode(code: string) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES ('collaborator-code',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(code.trim());
  }
  getIntegrationSecret(key: string) {
    return (
      (this.db
        .prepare("SELECT value FROM settings WHERE key=?")
        .get(`integration:${key}`) as { value: string } | undefined)?.value ?? ""
    );
  }
  saveIntegrationSecret(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(`integration:${key}`, value);
  }

  listMeetings(): Meeting[] {
    return this.db
      .prepare(
        "SELECT m.id,m.name,m.color,m.date,m.created_at createdAt,COUNT(i.id) itemCount FROM meetings m LEFT JOIN meeting_items i ON i.meeting_id=m.id GROUP BY m.id ORDER BY m.created_at DESC",
      )
      .all() as Meeting[];
  }
  createMeeting(name: string, date?: string | null) {
    return Number(
      this.db
        .prepare("INSERT INTO meetings(name,date) VALUES (?,?)")
        .run(name.trim(), date ?? null).lastInsertRowid,
    );
  }
  removeBundledDemoMeeting() {
    const migrationKey = "migration-remove-bundled-demo-v1";
    const alreadyApplied = this.db
      .prepare("SELECT 1 FROM settings WHERE key = ?")
      .get(migrationKey);
    if (alreadyApplied) return;
    const candidates = this.db
      .prepare("SELECT id FROM meetings WHERE name = ?")
      .all("Prueba multimedia") as Array<{ id: number }>;
    const allowedTitles = new Set(["Video de prueba", "PowerPoint de prueba"]);
    const readItems = this.db.prepare(
      "SELECT title FROM meeting_items WHERE meeting_id = ?",
    );
    const remove = this.db.prepare("DELETE FROM meetings WHERE id = ?");
    const markApplied = this.db.prepare(
      "INSERT INTO settings(key,value) VALUES (?,?)",
    );
    this.db.transaction(() => {
      for (const candidate of candidates) {
        const items = readItems.all(candidate.id) as Array<{ title: string }>;
        // Remove only the exact sample generated by older builds. A meeting
        // the operator modified or extended is preserved.
        if (
          items.length <= 2 &&
          items.every((item) => allowedTitles.has(item.title))
        )
          remove.run(candidate.id);
      }
      markApplied.run(migrationKey, "1");
    })();
  }
  deleteMeeting(id: number) {
    this.db.prepare("DELETE FROM meetings WHERE id=?").run(id);
  }
  updateMeeting(id: number, patch: Partial<Pick<Meeting, "name" | "color">>) {
    this.db
      .prepare(
        "UPDATE meetings SET name=COALESCE(?,name),color=COALESCE(?,color) WHERE id=?",
      )
      .run(patch.name?.trim() || null, patch.color ?? null, id);
  }
  listMeetingItems(meetingId: number): MeetingItem[] {
    const rows = this.db
      .prepare(
        "SELECT id,meeting_id meetingId,position,type,title,color,payload,created_at createdAt FROM meeting_items WHERE meeting_id=? ORDER BY position,id",
      )
      .all(meetingId) as Array<
      Omit<MeetingItem, "payload"> & { payload: string }
    >;
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  saveMeetingItem(
    item: Partial<MeetingItem> & {
      meetingId: number;
      type: string;
      title: string;
      color: string;
      payload: Record<string, unknown>;
    },
  ) {
    if (item.id) {
      this.db
        .prepare(
          "UPDATE meeting_items SET type=?,title=?,color=?,payload=? WHERE id=?",
        )
        .run(
          item.type,
          item.title,
          item.color,
          JSON.stringify(item.payload),
          item.id,
        );
      return item.id;
    }
    const next = (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(position),0)+1 value FROM meeting_items WHERE meeting_id=?",
        )
        .get(item.meetingId) as { value: number }
    ).value;
    return Number(
      this.db
        .prepare(
          "INSERT INTO meeting_items(meeting_id,position,type,title,color,payload) VALUES (?,?,?,?,?,?)",
        )
        .run(
          item.meetingId,
          next,
          item.type,
          item.title,
          item.color,
          JSON.stringify(item.payload),
        ).lastInsertRowid,
    );
  }
  deleteMeetingItem(id: number) {
    this.db.prepare("DELETE FROM meeting_items WHERE id=?").run(id);
  }
  reorderMeetingItems(meetingId: number, ids: number[]) {
    const update = this.db.prepare(
      "UPDATE meeting_items SET position=? WHERE id=? AND meeting_id=?",
    );
    this.db.transaction(() =>
      ids.forEach((id, index) => update.run(index + 1, id, meetingId)),
    )();
  }
}
