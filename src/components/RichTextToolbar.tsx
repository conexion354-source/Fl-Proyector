import { useState, type CSSProperties } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Eraser,
  Highlighter,
  Italic,
  Palette,
  Sparkles,
} from "lucide-react";
import { projectionFonts } from "../fonts";

export const richTextColors = [
  "#ffffff",
  "#fde68a",
  "#facc15",
  "#86efac",
  "#67e8f9",
  "#93c5fd",
  "#c4b5fd",
  "#f9a8d4",
  "#fca5a5",
];
export const richHighlightColors = [
  "#facc15",
  "#fb923c",
  "#f87171",
  "#4ade80",
  "#22d3ee",
  "#818cf8",
  "#e879f9",
];

export function RichTextToolbar({
  editor,
  fontSize,
  onFontSize,
  shadow,
  onShadowChange,
  className = "",
}: {
  editor: Editor | null;
  fontSize?: number;
  onFontSize?: (value: number) => void;
  shadow?: { enabled: boolean; color: string; blur: number };
  onShadowChange?: (shadow: {
    enabled: boolean;
    color: string;
    blur: number;
  }) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<"text" | "highlight" | "shadow" | null>(
    null,
  );
  const choose = (type: "text" | "highlight", color: string) => {
    if (type === "text") editor?.chain().focus().setColor(color).run();
    else editor?.chain().focus().toggleHighlight({ color }).run();
    setOpen(null);
  };
  return (
    <div
      className={`announcement-toolbar ${className}`}
      onMouseDown={(event) => {
        // On Windows a toolbar button can steal focus before its click runs,
        // which clears TipTap's selected text and makes Bold appear inert.
        // Keeping focus in the editor preserves the selected range.
        if ((event.target as HTMLElement).closest("button"))
          event.preventDefault();
      }}
    >
      <select
        defaultValue="Inter"
        title="Fuente"
        onChange={(event) =>
          editor?.chain().focus().setFontFamily(event.target.value).run()
        }
      >
        {projectionFonts.map((font) => (
          <option value={font.value} key={font.label}>
            {font.label}
          </option>
        ))}
      </select>
      {fontSize !== undefined && onFontSize && (
        <label className="toolbar-size">
          Tamaño
          <input
            aria-label="Tamaño del texto"
            type="number"
            min="18"
            max="140"
            value={fontSize}
            onChange={(event) =>
              onFontSize(
                Math.max(18, Math.min(140, Number(event.target.value))),
              )
            }
          />
        </label>
      )}
      <button
        className={editor?.isActive("bold") ? "active" : ""}
        onClick={() => editor?.chain().focus().toggleBold().run()}
        title="Negrita"
      >
        <Bold />
      </button>
      <button
        className={editor?.isActive("italic") ? "active" : ""}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
        title="Cursiva"
      >
        <Italic />
      </button>
      <span className="toolbar-divider" />
      <div className="inline-color-menus">
        <div className="toolbar-color-menu">
          <button
            className={open === "text" ? "active" : ""}
            title="Color del texto"
            aria-label="Color del texto"
            onClick={() =>
              setOpen((value) => (value === "text" ? null : "text"))
            }
          >
            <Palette />
          </button>
          {open === "text" && (
            <div className="toolbar-palette">
              <strong>Color del texto</strong>
              <div>
                {richTextColors.map((color) => (
                  <button
                    className="format-swatch"
                    style={{ "--swatch": color } as CSSProperties}
                    title={color}
                    onClick={() => choose("text", color)}
                    key={color}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="toolbar-color-menu">
          <button
            className={open === "highlight" ? "active" : ""}
            title="Resaltado"
            aria-label="Resaltado"
            onClick={() =>
              setOpen((value) => (value === "highlight" ? null : "highlight"))
            }
          >
            <Highlighter />
          </button>
          {open === "highlight" && (
            <div className="toolbar-palette highlight-palette">
              <strong>Color de resaltado</strong>
              <div>
                {richHighlightColors.map((color) => (
                  <button
                    className="format-swatch highlight"
                    style={{ "--swatch": color } as CSSProperties}
                    title={color}
                    onClick={() => choose("highlight", color)}
                    key={color}
                  />
                ))}
              </div>
              <button
                className="clear-highlight"
                onClick={() => {
                  editor?.chain().focus().unsetHighlight().run();
                  setOpen(null);
                }}
              >
                <Eraser /> Quitar resaltado
              </button>
            </div>
          )}
        </div>
        {shadow && onShadowChange && (
          <div className="toolbar-color-menu">
            <button
              className={open === "shadow" || shadow.enabled ? "active" : ""}
              title="Sombra del texto"
              aria-label="Sombra del texto"
              onClick={() =>
                setOpen((value) => (value === "shadow" ? null : "shadow"))
              }
            >
              <Sparkles />
            </button>
            {open === "shadow" && (
              <div className="toolbar-palette shadow-palette">
                <div className="shadow-heading">
                  <strong>Sombra del texto</strong>
                  <label className="shadow-toggle">
                    <input
                      type="checkbox"
                      checked={shadow.enabled}
                      onChange={(event) =>
                        onShadowChange({
                          ...shadow,
                          enabled: event.target.checked,
                        })
                      }
                    />
                    {shadow.enabled ? "Activada" : "Desactivada"}
                  </label>
                </div>
                <span>Color</span>
                <div>
                  {["#000000", "#111827", "#312e81", "#7f1d1d", "#ffffff"].map(
                    (color) => (
                      <button
                        className={`format-swatch ${shadow.color === color ? "selected" : ""}`}
                        style={{ "--swatch": color } as CSSProperties}
                        title={color}
                        onClick={() => onShadowChange({ ...shadow, color })}
                        key={color}
                      />
                    ),
                  )}
                </div>
                <label className="shadow-amount">
                  <span>
                    Intensidad <b>{shadow.blur}px</b>
                  </span>
                  <input
                    aria-label="Intensidad de sombra"
                    type="range"
                    min="0"
                    max="40"
                    value={shadow.blur}
                    style={
                      {
                        "--shadow-progress": `${(shadow.blur / 40) * 100}%`,
                      } as CSSProperties
                    }
                    onChange={(event) =>
                      onShadowChange({
                        ...shadow,
                        blur: Math.max(
                          0,
                          Math.min(40, Number(event.target.value)),
                        ),
                      })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
