const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("flProyector", {
  getState: () => ipcRenderer.invoke("projection:get-state"),
  updateState: (patch) => ipcRenderer.invoke("projection:update-state", patch),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("projection:state", listener);
    return () => ipcRenderer.removeListener("projection:state", listener);
  },
  openProjection: () => ipcRenderer.invoke("projection:open"),
  closeProjection: () => ipcRenderer.invoke("projection:close"),
  projectionStatus: () => ipcRenderer.invoke("projection:status"),
  enableWindowsRemoteAccess: () =>
    ipcRenderer.invoke("remote:enable-windows-access"),
  getLiveAudienceStatus: () => ipcRenderer.invoke("live-audience:status"),
  startLiveAudience: () => ipcRenderer.invoke("live-audience:start"),
  stopLiveAudience: () => ipcRenderer.invoke("live-audience:stop"),
  listMedia: () => ipcRenderer.invoke("media:list"),
  importMedia: (paths) => ipcRenderer.invoke("media:import", paths),
  chooseMediaFiles: () => ipcRenderer.invoke("media:choose"),
  chooseMeetingMedia: () => ipcRenderer.invoke("media:choose-for-meeting"),
  importDroppedFiles: (files) =>
    ipcRenderer.invoke(
      "media:import",
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  setFavorite: (id, slot) => ipcRenderer.invoke("media:favorite", id, slot),
  setTags: (id, tags) => ipcRenderer.invoke("media:tags", id, tags),
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
