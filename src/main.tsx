import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode disabled: Excalidraw's internal tunnel-rat store loops
// ("Maximum update depth exceeded") under React 19 StrictMode double-rendering.
createRoot(document.getElementById('root')!).render(<App />)
