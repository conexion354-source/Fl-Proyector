export type MediaItem = {
  id: number;
  name: string;
  path: string;
  url: string;
  tags: string[];
  favoriteSlot: number | null;
  kind: "image" | "video";
};

export type SongCategory = { id: number; name: string; songCount: number };
export type SongSectionType =
  | "verse"
  | "chorus"
  | "prechorus"
  | "bridge"
  | "intro"
  | "interlude"
  | "ending"
  | "other";
export type Song = {
  id: number;
  title: string;
  color: string;
  categoryId: number | null;
  categoryName: string | null;
  content: string;
  sectionTypes: SongSectionType[];
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  createdAt: string;
  updatedAt: string;
};
export type BibleVersion = {
  id: number;
  code: string;
  name: string;
  language: string;
  enabled: boolean;
};
export type BibleBook = { book: string; chapters: number };
export type BibleVerse = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
};
export type Meeting = {
  id: number;
  name: string;
  color: string;
  date: string | null;
  createdAt: string;
  itemCount: number;
};
export type MeetingItemType =
  | "announcement"
  | "song"
  | "bible"
  | "media"
  | "presentation";
export type MeetingItem = {
  id: number;
  meetingId: number;
  position: number;
  type: MeetingItemType;
  title: string;
  color: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
export type DisplayInfo = {
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  cssWidth: number;
  cssHeight: number;
  primary: boolean;
};
export type DisplaySettings = {
  aspectRatio: "auto" | "16:9" | "16:10" | "4:3" | "custom";
  backgroundColor: string;
  resolution: "display" | "1920x1080" | "1280x720" | "1024x768";
  mainDisplayId: number | null;
  thirdDisplayEnabled: boolean;
  thirdDisplayId: number | null;
};

export type ChurchSettings = {
  name: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  logoPath: string | null;
  logoUrl: string | null;
  logoMode: "centered" | "fullscreen";
  logoBackgroundColor: string;
};

export type BibleDisplaySettings = {
  uppercase: boolean;
  showReference: boolean;
  showVersion: boolean;
  textFontFamily: string;
  referenceFontFamily: string;
  textFontSize: number;
  minimumFontSize: number;
  referenceFontSize: number;
  textColor: string;
  textShadowEnabled: boolean;
  textShadowColor: string;
  textShadowBlur: number;
  referenceColor: string;
  referenceBackground: string;
  referenceStyle: "minimal" | "pill" | "bar" | "glass" | "underline" | "ribbon";
  referencePosition: "before" | "after";
  fillScreen: boolean;
  horizontalMargin: number;
  verticalMargin: number;
  longVerseMode: "auto-fit" | "split" | "split-halves";
  maxLinesPerSlide: number;
};

export type SongDisplaySettings = {
  uppercase: boolean;
  fontFamily: string;
  fontSize: number;
  minimumFontSize: number;
  autoFit: boolean;
  textColor: string;
  backgroundColor: string;
  position: "top" | "center" | "bottom" | "lower";
  align: "left" | "center" | "right";
  borderRadius: number;
  template: "plain" | "classic" | "accent" | "glass" | "solid" | "gradient";
  showTitle: boolean;
  titleColor: string;
  titleBackground: string;
  titleFontFamily: string;
  titleFontSize: number;
  titleStyle: "none" | "bar" | "pill" | "glass" | "ribbon" | "accent";
  titlePosition: "top" | "center" | "bottom";
};

export const initialDisplaySettings: DisplaySettings = {
  aspectRatio: "auto",
  backgroundColor: "#000000",
  resolution: "display",
  mainDisplayId: null,
  thirdDisplayEnabled: false,
  thirdDisplayId: null,
};
export const initialChurchSettings: ChurchSettings = {
  name: "Mi Iglesia",
  address: "",
  city: "",
  phone: "",
  email: "",
  website: "",
  logoPath: null,
  logoUrl: null,
  logoMode: "centered",
  logoBackgroundColor: "#090b10",
};
export const initialBibleDisplaySettings: BibleDisplaySettings = {
  uppercase: false,
  showReference: true,
  showVersion: true,
  textFontFamily: "Inter",
  referenceFontFamily: "Inter",
  textFontSize: 60,
  minimumFontSize: 38,
  referenceFontSize: 24,
  textColor: "#ffffff",
  textShadowEnabled: true,
  textShadowColor: "#000000",
  textShadowBlur: 14,
  referenceColor: "#ffffff",
  referenceBackground: "#4f46e5",
  referenceStyle: "pill",
  referencePosition: "after",
  fillScreen: false,
  horizontalMargin: 8,
  verticalMargin: 10,
  longVerseMode: "auto-fit",
  maxLinesPerSlide: 3,
};
export const initialSongDisplaySettings: SongDisplaySettings = {
  uppercase: false,
  fontFamily: "Inter",
  fontSize: 64,
  minimumFontSize: 32,
  autoFit: true,
  textColor: "#ffffff",
  backgroundColor: "rgba(0,0,0,0)",
  position: "center",
  align: "center",
  borderRadius: 12,
  template: "plain",
  showTitle: false,
  titleColor: "#ffffff",
  titleBackground: "#4f46e5",
  titleFontFamily: "Inter",
  titleFontSize: 30,
  titleStyle: "bar",
  titlePosition: "top",
};

export type BackgroundState = {
  id: number | null;
  url: string | null;
  name: string;
  kind: "image" | "video" | null;
  dim: number;
  blur: number;
  speed: 0.5 | 1 | 1.5;
};

export type VideoPlaybackState = {
  playing: boolean;
  volume: number;
  muted: boolean;
  seekTime: number;
  commandId: number;
  /** Playback telemetry is shared with the remote controller. */
  duration: number;
  currentTime: number;
};

export type PresentationState = {
  path: string | null;
  url: string | null;
  name: string;
  slideIndex: number;
  slideCount: number;
  visible: boolean;
  previewSlides?: string[];
};
export type OverlayTimer = { visible: boolean; running: boolean; startedAt: number; duration: number; remaining: number; position: "top" | "center" | "bottom"; fontSize: number; color: string };
export type OverlayClock = { visible: boolean; position: "top" | "center" | "bottom"; fontSize: number; color: string };
export type OverlayAlert = {
  visible: boolean;
  message: string;
  position: "top" | "center" | "bottom";
  fontSize: number;
  color: string;
  animation: "none" | "pulse" | "scroll" | "bounce";
};

export type ProjectionState = {
  outputViewport: {
    width: number;
    height: number;
    scaleFactor: number;
  };
  background: BackgroundState;
  text: {
    html: string;
    visible: boolean;
    kind: "biblia" | "canto" | "anuncio";
    fontSize: number;
    fontFamily: string;
    align: "left" | "center" | "right";
    color: string;
    backgroundColor: string;
    position: "top" | "center" | "bottom" | "lower";
    borderRadius: number;
    template: "plain" | "classic" | "accent" | "glass" | "solid" | "gradient";
    shadowEnabled: boolean;
    shadowColor: string;
    shadowBlur: number;
    title: string;
    titlePosition: "top" | "center" | "bottom";
    titleColor: string;
    titleBackground: string;
    titleFontSize: number;
    titleStyle: "none" | "bar" | "pill" | "glass" | "ribbon" | "accent";
  };
  lowerThird: { title: string; subtitle: string; visible: boolean };
  presentation: PresentationState;
  video: VideoPlaybackState;
  bibleStyle: BibleDisplaySettings;
  songStyle: SongDisplaySettings;
  church: ChurchSettings;
  timer: OverlayTimer;
  clock: OverlayClock;
  alert: OverlayAlert;
  blackout: boolean;
  logo: boolean;
};

export const initialProjectionState: ProjectionState = {
  outputViewport: { width: 1920, height: 1080, scaleFactor: 1 },
  background: {
    id: null,
    url: null,
    name: "",
    kind: null,
    dim: 30,
    blur: 0,
    speed: 1,
  },
  text: {
    html: "<p>Bienvenidos</p>",
    visible: true,
    kind: "biblia",
    fontSize: 64,
    fontFamily: "Inter",
    align: "center",
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0)",
    position: "center",
    borderRadius: 12,
    template: "plain",
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowBlur: 14,
    title: "",
    titlePosition: "bottom",
    titleColor: "#ffffff",
    titleBackground: "#4f46e5",
    titleFontSize: 30,
    titleStyle: "bar",
  },
  lowerThird: { title: "", subtitle: "", visible: false },
  presentation: {
    path: null,
    url: null,
    name: "",
    slideIndex: 0,
    slideCount: 0,
    visible: false,
  },
  video: { playing: true, volume: 1, muted: false, seekTime: 0, commandId: 0, duration: 0, currentTime: 0 },
  bibleStyle: initialBibleDisplaySettings,
  songStyle: initialSongDisplaySettings,
  church: initialChurchSettings,
  timer: { visible: false, running: false, startedAt: 0, duration: 300, remaining: 300, position: "top", fontSize: 42, color: "#ffffff" },
  clock: { visible: false, position: "top", fontSize: 36, color: "#ffffff" },
  alert: { visible: false, message: "Bebé llorando", position: "bottom", fontSize: 42, color: "#ffffff", animation: "pulse" },
  blackout: false,
  logo: false,
};

export type ProjectionPatch = Partial<
  Omit<
    ProjectionState,
    | "background"
    | "text"
    | "lowerThird"
    | "presentation"
    | "video"
    | "bibleStyle"
    | "songStyle"
    | "church"
    | "timer"
    | "clock"
    | "alert"
    | "outputViewport"
  >
> & {
  background?: Partial<BackgroundState>;
  text?: Partial<ProjectionState["text"]>;
  lowerThird?: Partial<ProjectionState["lowerThird"]>;
  presentation?: Partial<PresentationState>;
  video?: Partial<VideoPlaybackState>;
  bibleStyle?: Partial<BibleDisplaySettings>;
  songStyle?: Partial<SongDisplaySettings>;
  church?: Partial<ChurchSettings>;
  timer?: Partial<OverlayTimer>;
  clock?: Partial<OverlayClock>;
  alert?: Partial<OverlayAlert>;
  outputViewport?: Partial<ProjectionState["outputViewport"]>;
};

export type UpdateStatus = {
  state:
    | "idle"
    | "current"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "development";
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  message: string;
  packaged: boolean;
};

export type ReleaseHistoryEntry = {
  version: string;
  title: string;
  publishedAt: string | null;
  changes: string[];
};
