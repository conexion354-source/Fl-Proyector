/// <reference types="vite/client" />

import type {
  BibleBook,
  BibleDisplaySettings,
  BibleVerse,
  BibleVersion,
  SongDisplaySettings,
  ChurchSettings,
  DisplaySettings,
  DisplayInfo,
  MediaItem,
  Meeting,
  MeetingItem,
  LiveAudienceStatus,
  ProjectionPatch,
  ProjectionState,
  ReleaseHistoryEntry,
  Song,
  SongCategory,
  UpdateStatus,
} from "../shared/types";

declare global {
  interface Window {
    flProyector: {
      getState(): Promise<ProjectionState>;
      updateState(patch: ProjectionPatch): Promise<void>;
      finishVideoPlayback(): Promise<void>;
      onState(callback: (state: ProjectionState) => void): () => void;
      openProjection(): Promise<void>;
      closeProjection(): Promise<void>;
      projectionStatus(): Promise<{
        open: boolean;
        displays: DisplayInfo[];
        remoteUrls: string[];
      }>;
      enableWindowsRemoteAccess(): Promise<boolean>;
      getLiveAudienceStatus(): Promise<LiveAudienceStatus>;
      startLiveAudience(): Promise<LiveAudienceStatus>;
      stopLiveAudience(): Promise<LiveAudienceStatus>;
      listMedia(): Promise<MediaItem[]>;
      importMedia(paths: string[]): Promise<MediaItem[]>;
      chooseMediaFiles(): Promise<MediaItem[]>;
      chooseMeetingMedia(): Promise<MediaItem[]>;
      importDroppedFiles(files: File[]): Promise<MediaItem[]>;
      setFavorite(id: number, slot: number | null): Promise<void>;
      setTags(id: number, tags: string[]): Promise<void>;
      editMediaTags(id: number, tags: string[]): Promise<string[] | null>;
      deleteMedia(id: number): Promise<boolean>;
      onMediaChanged(callback: () => void): () => void;
      listSongs(search?: string, categoryId?: number | null): Promise<Song[]>;
      listSongCategories(): Promise<SongCategory[]>;
      saveSong(
        song: Partial<Song> & { title: string; content: string },
      ): Promise<number>;
      deleteSong(id: number): Promise<void>;
      createSongCategory(name: string): Promise<number>;
      listBibleVersions(): Promise<BibleVersion[]>;
      setBibleVersionEnabled(id: number, enabled: boolean): Promise<void>;
      listBibleBooks(versionId: number): Promise<BibleBook[]>;
      listBibleVerses(
        versionId: number,
        book: string,
        chapter: number,
      ): Promise<BibleVerse[]>;
      searchBible(versionId: number, search: string): Promise<BibleVerse[]>;
      importBible(): Promise<boolean>;
      getDisplaySettings(): Promise<DisplaySettings>;
      saveDisplaySettings(settings: DisplaySettings): Promise<void>;
      onDisplaySettings(callback: (settings: DisplaySettings) => void): () => void;
      getChurchSettings(): Promise<ChurchSettings>;
      saveChurchSettings(settings: ChurchSettings): Promise<void>;
      pickChurchLogo(): Promise<{ path: string; url: string } | null>;
      getBibleDisplaySettings(): Promise<BibleDisplaySettings>;
      saveBibleDisplaySettings(settings: BibleDisplaySettings): Promise<void>;
      getSongDisplaySettings(): Promise<SongDisplaySettings>;
      saveSongDisplaySettings(settings: SongDisplaySettings): Promise<void>;
      getCollaboratorCode(): Promise<string>;
      saveCollaboratorCode(code: string): Promise<void>;
      listMeetings(): Promise<Meeting[]>;
      createMeeting(name: string, date?: string | null): Promise<number>;
      deleteMeeting(id: number): Promise<void>;
      updateMeeting(
        id: number,
        patch: Partial<Pick<Meeting, "name" | "color">>,
      ): Promise<void>;
      listMeetingItems(meetingId: number): Promise<MeetingItem[]>;
      saveMeetingItem(
        item: Partial<MeetingItem> & {
          meetingId: number;
          type: string;
          title: string;
          color: string;
          payload: Record<string, unknown>;
        },
      ): Promise<number>;
      deleteMeetingItem(id: number): Promise<void>;
      reorderMeetingItems(meetingId: number, ids: number[]): Promise<void>;
      onLibraryChanged(callback: (scope: "songs" | "meetings") => void): () => void;
      importPresentation(): Promise<{
        path: string;
        url: string;
        name: string;
        previewSlides?: string[];
      } | null>;
      openPresentation(path: string): Promise<string>;
      openExternal(url: string): Promise<boolean>;
      getUpdateStatus(): Promise<UpdateStatus>;
      getReleaseHistory(): Promise<ReleaseHistoryEntry[]>;
      checkForUpdates(): Promise<UpdateStatus>;
      downloadUpdate(): Promise<UpdateStatus>;
      installUpdate(): Promise<boolean>;
      onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
      platform: string;
    };
  }
}

export {};
