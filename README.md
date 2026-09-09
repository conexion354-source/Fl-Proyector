# Fl Proyector

Software local de proyección para iglesias, construido con Electron, React, TypeScript, Vite, TailwindCSS, SQLite, Socket.io y TipTap.

## Desarrollo

```bash
pnpm install
pnpm dev
```

Los fondos se observan automáticamente desde `Documentos/IglesiaPro/Fondos`. El control remoto queda disponible en el puerto `3001` de la red local.

## Módulos incluidos

- Canciones con categorías, búsqueda, editor enriquecido y guardado local.
- Fondos de imagen y video con WATCH, etiquetas, favoritos y conversión FFmpeg de MKV/AVI.
- Operador bíblico offline con Reina-Valera 1909 e importación de versiones JSON.
- Configuración de pantalla principal, resolución, relación de aspecto, color y tercera salida duplicada.
- Constructor de reuniones con escaleta drag-and-drop, colores, anuncios diseñables, canciones, Biblia, multimedia y presentaciones.

## Distribución

```bash
pnpm dist:mac
pnpm dist:win
```

La compilación para Windows debe ejecutarse preferentemente en Windows; la de macOS requiere macOS para firma y DMG.
