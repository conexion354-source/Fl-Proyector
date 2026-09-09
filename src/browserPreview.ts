import {
  initialBibleDisplaySettings,
  initialDisplaySettings,
  initialProjectionState,
  type Meeting,
  type MeetingItem,
  type MediaItem,
  type ProjectionState,
  type Song,
} from "../shared/types";

if (!window.flProyector) {
  let state: ProjectionState = structuredClone(initialProjectionState);
  let displaySettings = structuredClone(initialDisplaySettings);
  let stateListeners: Array<(state: ProjectionState) => void> = [];
  let meetings: Meeting[] = [];
  let songs: Song[] = [];
  let media: MediaItem[] = [];
  let items: MeetingItem[] = [];
  let nextId = 10;
  const selectBrowserFiles = (accept: string, multiple = false) =>
    new Promise<File[]>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = () => resolve(Array.from(input.files ?? []));
      input.oncancel = () => resolve([]);
      input.click();
    });
  const importBrowserMedia = (files: File[]): MediaItem[] => {
    const imported = files
      .filter(
        (file) =>
          /^(image|video)\//.test(file.type) ||
          /\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|mkv|m4v|avi|wmv|flv|mpeg|mpg|ts|mts|m2ts|ogv|3gp|vob|asf|divx|rm|rmvb|f4v|mxf|dv)$/i.test(
            file.name,
          ),
      )
      .map((file) => {
        const isImage =
          file.type.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name);
        return {
          id: ++nextId,
          name: file.name,
          path: file.name,
          url: URL.createObjectURL(file),
          tags: [],
          favoriteSlot: null,
          kind: isImage ? "image" : "video",
        } as MediaItem;
      });
    media = [...media, ...imported];
    return imported;
  };
  const chooseBrowserMedia = async (multiple = true) =>
    importBrowserMedia(await selectBrowserFiles("image/*,video/*", multiple));
  const chooseBrowserPresentation = async () => {
    const [file] = await selectBrowserFiles(
      ".pptx,.ppsx,.pptm,.potx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    if (!file) return null;
    return {
      path: file.name,
      url: URL.createObjectURL(file),
      name: file.name,
    };
  };
  const api: any = {
    getState: async () => state,
    updateState: async (patch: any) => {
      state = {
        ...state,
        ...patch,
        background: { ...state.background, ...patch.background },
        text: { ...state.text, ...patch.text },
        lowerThird: { ...state.lowerThird, ...patch.lowerThird },
        presentation: { ...state.presentation, ...patch.presentation },
        video: { ...state.video, ...patch.video },
        bibleStyle: { ...state.bibleStyle, ...patch.bibleStyle },
        songStyle: { ...state.songStyle, ...patch.songStyle },
        church: { ...state.church, ...patch.church },
        timer: { ...state.timer, ...patch.timer },
        clock: { ...state.clock, ...patch.clock },
        alert: { ...state.alert, ...patch.alert },
      };
      stateListeners.forEach((listener) => listener(state));
    },
    onState: (listener: any) => {
      stateListeners.push(listener);
      return () => {
        stateListeners = stateListeners.filter((value) => value !== listener);
      };
    },
    openProjection: async () => {},
    closeProjection: async () => {},
    projectionStatus: async () => ({
      open: false,
      displays: [
        {
          id: 1,
          label: "Pantalla integrada",
          width: 1920,
          height: 1080,
          primary: true,
        },
        {
          id: 2,
          label: "Proyector HDMI",
          width: 1920,
          height: 1080,
          primary: false,
        },
      ],
      // Cuando la vista de revisión se abre por la IP LAN, puede mostrar el
      // mismo QR del servidor Electron que está ejecutándose en esa PC.
      // En localhost no lo mostramos porque un teléfono no puede resolverlo.
      remoteUrls:
        !["localhost", "127.0.0.1", "::1"].includes(location.hostname)
          ? [`http://${location.hostname}:3001`]
          : [],
    }),
    listMedia: async () => media,
    importMedia: async () => media,
    chooseMediaFiles: async () => {
      await chooseBrowserMedia();
      return media;
    },
    chooseMeetingMedia: async () => chooseBrowserMedia(),
    importDroppedFiles: async (files: File[]) => {
      importBrowserMedia(files);
      return media;
    },
    setFavorite: async () => {},
    setTags: async () => {},
    editMediaTags: async (_id: number, tags: string[]) => tags,
    deleteMedia: async (id: number) => {
      media = media.filter((item) => item.id !== id);
      return true;
    },
    onMediaChanged: () => () => {},
    listSongs: async (search = "") =>
      songs.filter((song) =>
        song.title.toLowerCase().includes(search.toLowerCase()),
      ),
    listSongCategories: async () => [],
    saveSong: async (song: any) => {
      if (song.id) {
        songs = songs.map((value) =>
          value.id === song.id
            ? { ...value, ...song, updatedAt: new Date().toISOString() }
            : value,
        );
        return song.id;
      }
      const id = ++nextId;
      songs.push({
        ...song,
        id,
        color: song.color || "#8b5cf6",
        categoryName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return id;
    },
    deleteSong: async () => {},
    createSongCategory: async () => 1,
    listBibleVersions: async () => [
      { id: 1, code: "RV1909", name: "Reina-Valera 1909", language: "es", enabled: true },
      { id: 2, code: "DHH", name: "Biblia Dios Habla Hoy", language: "es", enabled: true },
      {
        id: 3,
        code: "LBLA",
        name: "La Biblia de las Américas",
        language: "es", enabled: true,
      },
      { id: 4, code: "NTV", name: "Nueva Traducción Viviente", language: "es", enabled: true },
      {
        id: 5,
        code: "NVI",
        name: "Nueva Versión Internacional",
        language: "es", enabled: true,
      },
      { id: 6, code: "RVR1960", name: "Reina-Valera 1960", language: "es", enabled: true },
      {
        id: 7,
        code: "TLA",
        name: "Traducción en Lenguaje Actual",
        language: "es", enabled: true,
      },
      {
        id: 8,
        code: "BLH",
        name: "Biblia Latinoamericana de Hoy",
        language: "es", enabled: true,
      },
    ],
    setBibleVersionEnabled: async () => {},
    listBibleBooks: async () => [
      { book: "Génesis", chapters: 50 },
      { book: "Salmos", chapters: 150 },
      { book: "Juan", chapters: 21 },
    ],
    listBibleVerses: async (
      _versionId: number,
      book: string,
      chapter: number,
    ) => [
      {
        book,
        chapter,
        verse: 1,
        text: "En el principio era el Verbo, y el Verbo era con Dios, y el Verbo era Dios.",
      },
      { book, chapter, verse: 2, text: "Este era en el principio con Dios." },
      {
        book,
        chapter,
        verse: 3,
        text: "Todas las cosas por él fueron hechas; y sin él nada de lo que es hecho, fue hecho.",
      },
      {
        book,
        chapter,
        verse: 4,
        text: "En él estaba la vida, y la vida era la luz de los hombres.",
      },
      {
        book,
        chapter,
        verse: 5,
        text: "Y la luz en las tinieblas resplandece; mas las tinieblas no la comprendieron.",
      },
      {
        book,
        chapter,
        verse: 16,
        text: "Porque de tal manera amó Dios al mundo, que ha dado á su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.",
      },
    ],
    searchBible: async (_versionId: number, search: string) => {
      const folded = search
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
      const terms = folded.split(/\s+/).filter(Boolean);
      const samples = await window.flProyector.listBibleVerses(0, "Juan", 3);
      return samples.filter((item) => {
        const text = item.text
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        return terms.every((term) => text.includes(term));
      });
    },
    importBible: async () => false,
    getDisplaySettings: async () => displaySettings,
    saveDisplaySettings: async (settings: any) => {
      displaySettings = { ...displaySettings, ...settings };
    },
    onDisplaySettings: () => () => {},
    getChurchSettings: async () => state.church,
    saveChurchSettings: async (settings: any) => {
      state = { ...state, church: settings };
      stateListeners.forEach((listener) => listener(state));
    },
    pickChurchLogo: async () => ({
      path: "preview-logo.png",
      url:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><circle cx="300" cy="300" r="250" fill="#655cff"/><path d="M300 115v370M175 245h250" stroke="white" stroke-width="55" stroke-linecap="round"/></svg>',
        ),
    }),
    getBibleDisplaySettings: async () =>
      state.bibleStyle || initialBibleDisplaySettings,
    saveBibleDisplaySettings: async (settings: any) => {
      state = { ...state, bibleStyle: settings };
      stateListeners.forEach((listener) => listener(state));
    },
    getSongDisplaySettings: async () => state.songStyle,
    saveSongDisplaySettings: async (settings: any) => {
      state = { ...state, songStyle: settings };
      stateListeners.forEach((listener) => listener(state));
    },
    getCollaboratorCode: async () => localStorage.getItem("fl-collaborator-code") || "",
    saveCollaboratorCode: async (code: string) => {
      localStorage.setItem("fl-collaborator-code", code);
    },
    listMeetings: async () => meetings,
    createMeeting: async (name: string, date: string) => {
      const id = ++nextId;
      meetings = [
        {
          id,
          name,
          color: "#665cff",
          date,
          createdAt: new Date().toISOString(),
          itemCount: 0,
        },
        ...meetings,
      ];
      return id;
    },
    deleteMeeting: async () => {},
    updateMeeting: async (id: number, patch: any) => {
      meetings = meetings.map((meeting) =>
        meeting.id === id ? { ...meeting, ...patch } : meeting,
      );
    },
    listMeetingItems: async (meetingId: number) =>
      items
        .filter((item) => item.meetingId === meetingId)
        .sort((a, b) => a.position - b.position),
    saveMeetingItem: async (item: any) => {
      if (item.id) {
        items = items.map((value) => (value.id === item.id ? item : value));
        return item.id;
      }
      const id = ++nextId;
      items.push({
        ...item,
        id,
        position:
          items.filter((value) => value.meetingId === item.meetingId).length +
          1,
        createdAt: "",
      });
      meetings = meetings.map((meeting) =>
        meeting.id === item.meetingId
          ? { ...meeting, itemCount: meeting.itemCount + 1 }
          : meeting,
      );
      return id;
    },
    deleteMeetingItem: async (id: number) => {
      items = items.filter((item) => item.id !== id);
    },
    reorderMeetingItems: async (_meetingId: number, ids: number[]) => {
      items = items.map((item) =>
        ids.includes(item.id)
          ? { ...item, position: ids.indexOf(item.id) + 1 }
          : item,
      );
    },
    importPresentation: chooseBrowserPresentation,
    openPresentation: async () => "",
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
    platform: "browser-preview",
  };
  window.flProyector = api;
}
