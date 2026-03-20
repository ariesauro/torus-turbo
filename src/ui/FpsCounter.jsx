import { useEffect, useRef, useState } from 'react'

const isTauri = typeof window !== 'undefined' && !!window.__TAURI__

export default function FpsCounter({ nativeRender = false }) {
  const [fps, setFps] = useState(0)
  const frameTimesRef = useRef([])
  const rafRef = useRef(null)

  useEffect(() => {
    let lastTime = performance.now()

    const tick = () => {
      const now = performance.now()
      const dt = now - lastTime
      lastTime = now

      const times = frameTimesRef.current
      times.push(dt)
      if (times.length > 60) times.shift()

      const avg = times.reduce((a, b) => a + b, 0) / times.length
      setFps(avg > 0 ? Math.round(1000 / avg) : 0)

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const prefix = nativeRender ? 'Native Render FPS:' : 'WebGL Render FPS:'

  return (
    <div
      className="fixed left-3 top-3 z-50 select-none"
      style={{
        fontFamily: 'SF Mono, Menlo, monospace',
        fontSize: 12,
        fontWeight: 600,
        color: '#e8eafc',
        background: 'rgba(12, 13, 30, 0.6)',
        backdropFilter: 'blur(8px)',
        padding: '4px 10px',
        borderRadius: 6,
        border: '0.5px solid rgba(99, 102, 241, 0.15)',
        letterSpacing: 0.5,
      }}
    >
      <span style={{ color: '#9094c0' }}>{prefix} </span>
      <span style={{ color: fps >= 50 ? '#e8eafc' : fps >= 30 ? '#f59e0b' : '#ef4444' }}>{fps}</span>
    </div>
  )
}
