import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/bebas-neue/latin-400.css'
import '@fontsource/bebas-neue/latin-ext-400.css'
import '@fontsource/raleway/latin-400.css'
import '@fontsource/raleway/latin-ext-400.css'
import '@fontsource/raleway/latin-700.css'
import '@fontsource/raleway/latin-ext-700.css'
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-ext-400.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/noto-sans/latin-ext-700.css'
import { App } from './App'
import { ProjectionPage } from './ProjectionPage'
import './styles.css'
import './features.css'
import './meeting-review.css'
import './fluent.css'
import './browserPreview'

const isProjection = location.hash.startsWith('#/projection')
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isProjection ? <ProjectionPage /> : <App />}</React.StrictMode>,
)
