const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("flProyector", {
  getState: () => ipcRenderer.invoke("projection:get-state"),
  getLiveState: () => ipcRenderer.invoke("projection:get-live-state"),
  updateState: (patch) => ipcRenderer.invoke("projection:update-state", patch),
  getProjectionFrozen: () => ipcRenderer.invoke("projection:freeze:get"),
  setProjectionFrozen: (frozen) => ipcRenderer.invoke("projection:freeze:set", frozen),
  getFloatingPreviewOpen: () => ipcRenderer.invoke("preview:window:get"),
  setFloatingPreviewOpen: (open) => ipcRenderer.invoke("preview:window:set", open),
  setPreviewState: (state) => ipcRenderer.invoke("preview:set-state", state),
  clearPreviewState: () => ipcRenderer.invoke("preview:clear"),
  clearProjectionContent: () => ipcRenderer.invoke("projection:clear-content"),
  finishVideoPlayback: () => ipcRenderer.invoke("projection:video-ended"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("projection:state", listener);
    return () => ipcRenderer.removeListener("projection:state", listener);
  },
  onLiveState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("projection:live-state", listener);
    return () => ipcRenderer.removeListener("projection:live-state", listener);
  },
  onProjectionFreezeStatus: (callback) => {
    const listener = (_event, frozen) => callback(frozen);
    ipcRenderer.on("projection:freeze-status", listener);
    return () => ipcRenderer.removeListener("projection:freeze-status", listener);
  },
  onFloatingPreviewStatus: (callback) => {
    const listener = (_event, open) => callback(open);
    ipcRenderer.on("preview:window-status", listener);
    return () => ipcRenderer.removeListener("preview:window-status", listener);
  },
  openProjection: () => ipcRenderer.invoke("projection:open"),
  closeProjection: () => ipcRenderer.invoke("projection:close"),
  projectionStatus: () => ipcRenderer.invoke("projection:status"),
  enableWindowsRemoteAccess: () =>
    ipcRenderer.invoke("remote:enable-windows-access"),
  getRemoteFullControlStatus: () =>
    ipcRenderer.invoke("remote:full-control:get"),
  setRemoteFullControlEnabled: (enabled) =>
    ipcRenderer.invoke("remote:full-control:set", enabled),
  getLiveAudienceStatus: () => ipcRenderer.invoke("live-audience:status"),
  startLiveAudience: () => ipcRenderer.invoke("live-audience:start"),
  stopLiveAudience: () => ipcRenderer.invoke("live-audience:stop"),
  listMedia: () => ipcRenderer.invoke("media:list"),
  importMedia: (paths) => ipcRenderer.invoke("media:import", paths),
  chooseMediaFiles: () => ipcRenderer.invoke("media:choose"),
  chooseMeetingMedia: () => ipcRenderer.invoke("media:choose-for-meeting"),
  searchOpenverse: (query, orientation, page = 1) =>
    ipcRenderer.invoke("openverse:search", query, orientation, page),
  loadRemoteImagePreview: (url) =>
    ipcRenderer.invoke("openverse:preview", url),
  importOpenverseMedia: (item) => ipcRenderer.invoke("openverse:import", item),
  importDroppedFiles: (files) =>
    ipcRenderer.invoke(
      "media:import",
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  setFavorite: (id, slot) => ipcRenderer.invoke("media:favorite", id, slot),
  setTags: (id, tags) => ipcRenderer.invoke("media:tags", id, tags),
  // Kept in sync with the public TypeScript API and the main-process handler.
  // This is used by the media editor when a tag-only edit is requested.
  editMediaTags: (id, tags) => ipcRenderer.invoke("media:edit-tags", id, tags),
  updateMediaDetails: (id, name, tags) =>
    ipcRenderer.invoke("media:update-details", id, name, tags),
  submitMediaTags: (tags) => ipcRenderer.send("media:tags-dialog-result", tags),
  deleteMedia: (id) => ipcRenderer.invoke("media:delete", id),
  onMediaChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("media:changed", listener);
    return () => ipcRenderer.removeListener("media:changed", listener);
  },
  listSongs: (search = "", categoryId = null) =>
    ipcRenderer.invoke("songs:list", search, categoryId),
  listSongCategories: () => ipcRenderer.invoke("songs:categories"),
  saveSong: (song) => ipcRenderer.invoke("songs:save", song),
  deleteSong: (id) => ipcRenderer.invoke("songs:delete", id),
  createSongCategory: (name) =>
    ipcRenderer.invoke("songs:create-category", name),
  searchLyrics: (title, artist) =>
    ipcRenderer.invoke("lyrics:search", title, artist),
  listBibleVersions: () => ipcRenderer.invoke("bible:versions"),
  setBibleVersionEnabled: (id, enabled) => ipcRenderer.invoke("bible:version-enabled", id, enabled),
  listBibleBooks: (versionId) => ipcRenderer.invoke("bible:books", versionId),
  listBibleVerses: (versionId, book, chapter) =>
    ipcRenderer.invoke("bible:verses", versionId, book, chapter),
  searchBible: (versionId, search) =>
    ipcRenderer.invoke("bible:search", versionId, search),
  importBible: () => ipcRenderer.invoke("bible:import"),
  getDisplaySettings: () => ipcRenderer.invoke("settings:display:get"),
  saveDisplaySettings: (settings) =>
    ipcRenderer.invoke("settings:display:set", settings),
  onDisplaySettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("projection:display-settings", listener);
    return () => ipcRenderer.removeListener("projection:display-settings", listener);
  },
  getChurchSettings: () => ipcRenderer.invoke("settings:church:get"),
  saveChurchSettings: (settings) =>
    ipcRenderer.invoke("settings:church:set", settings),
  pickChurchLogo: () => ipcRenderer.invoke("settings:church:pick-logo"),
  getBibleDisplaySettings: () => ipcRenderer.invoke("settings:bible:get"),
  saveBibleDisplaySettings: (settings) =>
    ipcRenderer.invoke("settings:bible:set", settings),
  getSongDisplaySettings: () => ipcRenderer.invoke("settings:songs:get"),
  saveSongDisplaySettings: (settings) =>
    ipcRenderer.invoke("settings:songs:set", settings),
  getCollaboratorCode: () => ipcRenderer.invoke("settings:collaborator:get"),
  saveCollaboratorCode: (code) =>
    ipcRenderer.invoke("settings:collaborator:set", code),
  listMeetings: () => ipcRenderer.invoke("meetings:list"),
  createMeeting: (name, date) =>
    ipcRenderer.invoke("meetings:create", name, date),
  deleteMeeting: (id) => ipcRenderer.invoke("meetings:delete", id),
  updateMeeting: (id, patch) =>
    ipcRenderer.invoke("meetings:update", id, patch),
  listMeetingItems: (meetingId) =>
    ipcRenderer.invoke("meeting-items:list", meetingId),
  saveMeetingItem: (item) => ipcRenderer.invoke("meeting-items:save", item),
  deleteMeetingItem: (id) => ipcRenderer.invoke("meeting-items:delete", id),
  reorderMeetingItems: (meetingId, ids) =>
    ipcRenderer.invoke("meeting-items:reorder", meetingId, ids),
  onLibraryChanged: (callback) => {
    const listener = (_event, scope) => callback(scope);
    ipcRenderer.on("library:changed", listener);
    return () => ipcRenderer.removeListener("library:changed", listener);
  },
  importPresentation: () => ipcRenderer.invoke("presentation:import"),
  readPresentation: (path) => ipcRenderer.invoke("presentation:read", path),
  openPresentation: (path) => ipcRenderer.invoke("presentation:open", path),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  getReleaseHistory: () => ipcRenderer.invoke("updates:release-history"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },
  platform: process.platform,
});
