import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
const shouldRegisterServiceWorker =
  'serviceWorker' in navigator &&
  (isLocalhost || (import.meta.env.PROD && window.isSecureContext))

if (shouldRegisterServiceWorker) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // Service worker is an enhancement; the app still works without it.
      })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
