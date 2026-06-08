import React from 'react'
import ReactDOM from 'react-dom/client'
import 'highlight.js/styles/github.css'
import './styles.css'
import App from './App'

function renderFatalError(error: unknown): void {
  const root = document.getElementById('root')

  if (!root) {
    return
  }

  const message = error instanceof Error ? error.message : 'The app could not render.'
  root.innerHTML = `
    <main class="app-shell">
      <section class="viewer">
        <div class="empty-state">
          <div class="empty-icon danger"></div>
          <h1>App did not load</h1>
          <p>${message.replace(/[<>&"]/g, (char) => {
            const escapes: Record<string, string> = {
              '<': '&lt;',
              '>': '&gt;',
              '&': '&amp;',
              '"': '&quot;'
            }

            return escapes[char] ?? char
          })}</p>
        </div>
      </section>
    </main>
  `
}

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (error) {
  renderFatalError(error)
}
