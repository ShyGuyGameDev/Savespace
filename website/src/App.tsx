import { DOWNLOAD_URL } from './config'
import { Logo } from './Logo'

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M10 3.5v9m0 0-3.75-3.75M10 12.5l3.75-3.75M4 15.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function App() {
  return (
    <main className="page">
      <div className="backdrop" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
        <span className="blob blob-d" />
      </div>
      <section className="hero">
        <Logo className="logo" />
        <h1 className="title">Savespace</h1>
        <a className="download" href={DOWNLOAD_URL} download>
          <DownloadIcon />
          <span>Download for macOS</span>
        </a>
      </section>
    </main>
  )
}
