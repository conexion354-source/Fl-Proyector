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
  let liveAudience = { active: false, code: null as string | null, viewers: 0 };
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
          cssWidth: 1920,
          cssHeight: 1080,
          scaleFactor: 1,
          primary: true,
        },
        {
          id: 2,
          label: "Proyector HDMI",
          width: 1920,
          height: 1080,
          cssWidth: 1920,
          cssHeight: 1080,
          scaleFactor: 1,
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
    enableWindowsRemoteAccess: async () => true,
    getLiveAudienceStatus: async () => liveAudience,
    startLiveAudience: async () => {
      liveAudience = {
        active: true,
        code: String(Math.floor(100000 + Math.random() * 900000)),
        viewers: 0,
      };
      return liveAudience;
    },
    stopLiveAudience: async () => {
      liveAudience = { active: false, code: null, viewers: 0 };
      return liveAudience;
    },
    listMedia: async () => media,
    importMedia: async () => media,
    chooseMediaFiles: async () => {
      await chooseBrowserMedia();
      return media;
    },
    chooseMeetingMedia: async () => chooseBrowserMedia(),
    getPexelsStatus: async () => ({ configured: false }),
    savePexelsApiKey: async (apiKey: string) => ({ configured: Boolean(apiKey.trim()) }),
    searchPexels: async () => ({ items: [], page: 1, totalResults: 0, hasMore: false }),
    importPexelsMedia: async () => media,
    importDroppedFiles: async (files: File[]) => {
      importBrowserMedia(files);
      return media;
    },
    setFavorite: async () => {},
    setTags: async () => {},
    updateMediaDetails: async (id: number, name: string, tags: string[]) => {
      media = media.map((item) =>
        item.id === id ? { ...item, name, tags } : item,
      );
    },
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
    searchLyrics: async () => [],
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
    getUpdateStatus: async () => ({
      state: "development",
      currentVersion: "10.11.6",
      availableVersion: null,
      progress: null,
      message: "La búsqueda está desactivada mientras se prueba el sistema.",
      packaged: false,
    }),
    getReleaseHistory: async () => [
      {
        version: "10.11.6",
        title: "Lectura en vivo, colaboración y encuadre inteligente",
        publishedAt: "2026-09-14T15:21:10Z",
        changes: [
          "Se incorporó una lectura en vivo por QR para que teléfonos y otros dispositivos sigan canciones y pasajes bíblicos en tiempo real.",
          "El control maestro del QR restaura correctamente el contenido anterior al quitarlo de la proyección.",
          "El modo colaborador permite organizar reuniones, crear y corregir canciones y editar anuncios con sincronización inmediata.",
          "Los videos restauran el fondo al finalizar y se encuadran completos en pantallas 4:3, 16:9 y otras proporciones sin recortarse.",
          "Rellenar pantalla aprovecha mejor el área disponible y reduce sutilmente texto y referencia cuando una tipografía podría quedar cortada.",
          "La división bíblica A/B evita partes innecesarias y protege cada fragmento contra desbordes visuales.",
        ],
      },
      {
        version: "10.11.5",
        title: "Pantallas, diseño y proyección más confiables",
        publishedAt: "2026-09-12T18:00:00Z",
        changes: [
          "Los cambios de monitor principal y tercera pantalla se aplican en vivo, creando, moviendo o cerrando cada salida correctamente.",
          "La relación 16:9, 16:10 o 4:3 y la resolución elegida ahora se respetan en la salida real, manteniendo la ventana de Windows en pantalla completa.",
          "El color sin contenido se muestra también en la pantalla de proyección y se reforzó el uso de márgenes seguros.",
          "Anuncios y referencias incorporan nuevos zócalos, movimientos, fuentes Montserrat y Oswald y sombras consistentes.",
          "Se completó la transmisión de estilos y controles desde el sistema principal y el control remoto.",
        ],
      },
      {
        version: "10.11.4",
        title: "Versículos completos y división A/B inteligente",
        publishedAt: "2026-09-11T16:55:00Z",
        changes: [
          "Los versículos permanecen completos mientras entren físicamente en la pantalla al tamaño elegido.",
          "Los textos que desbordan se dividen una sola vez en dos partes equilibradas: A y B, nunca C o D.",
          "El cálculo considera la resolución real, los márgenes seguros y el espacio reservado para la referencia.",
          "El tamaño preferido de Biblia y canciones ahora admite valores de hasta 200.",
          "Biblia incorpora una protección automática que reduce el texto solo lo indispensable para evitar cortes.",
        ],
      },
      {
        version: "10.11.3",
        title: "Lectura bíblica más clara y estable",
        publishedAt: "2026-09-11T16:33:24Z",
        changes: [
          "El zócalo de referencia mantiene el tamaño configurado aunque cambie la longitud del pasaje.",
          "El texto bíblico utiliza un área independiente y ya no se superpone con la referencia.",
          "Los versículos se dividen solamente cuando superan la cantidad de líneas configurada.",
          "La división llena cada pantalla antes de crear las partes A, B o siguientes, sin cortar palabras.",
        ],
      },
      {
        version: "10.11.2",
        title: "Proyección y trabajo en red más confiables",
        publishedAt: "2026-09-11T14:26:08Z",
        changes: [
          "Se adaptaron los textos bíblicos y las canciones a la resolución real de la pantalla, sin cortar palabras.",
          "Se mejoró la división inteligente de versículos largos y el uso de los márgenes seguros.",
          "Se incorporó la clasificación de estrofas, coros, puentes y otras partes de las canciones.",
          "Se corrigió la restauración del fondo al quitar videos desde el control remoto.",
          "El instalador habilita el modo colaborador en el Firewall de Windows para la red local.",
          "Se eliminó la barra File/Edit/View de Windows y se mejoró el historial de actualizaciones.",
        ],
      },
      {
        version: "10.11.1",
        title: "Control remoto más confiable",
        publishedAt: "2026-09-10T13:34:11Z",
        changes: [
          "Se corrigió el control de reproducción multimedia desde el teléfono.",
          "Se mejoró la reconexión de la app móvil con FL Proyector.",
        ],
      },
      {
        version: "10.11.0",
        title: "Primera versión pública",
        publishedAt: "2026-09-09T20:33:22Z",
        changes: [
          "Se publicó el instalador de Windows en GitHub.",
          "Se incorporó la comprobación y descarga de actualizaciones.",
        ],
      },
    ],
    checkForUpdates: async () => window.flProyector.getUpdateStatus(),
    downloadUpdate: async () => window.flProyector.getUpdateStatus(),
    installUpdate: async () => false,
    onUpdateStatus: () => () => {},
    platform: "browser-preview",
  };
  window.flProyector = api;
}
