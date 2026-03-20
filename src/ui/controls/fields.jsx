import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

function getRangePrecision(step) {
  if (!Number.isFinite(step) || step >= 1) {
    return 0
  }

  const stepText = String(step)
  if (!stepText.includes('.')) {
    return 0
  }

  return stepText.split('.')[1].length
}

const TOOLTIP_WIDTH = 288

export function HintTooltip({ text }) {
  if (!text) return null
  const [pos, setPos] = useState(null)

  const handleEnter = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const vw = window.innerWidth
    const pad = 8
    const half = TOOLTIP_WIDTH / 2
    const clampedX = Math.max(pad + half, Math.min(vw - pad - half, cx))
    setPos({ x: clampedX, y: rect.top })
  }, [])

  const handleLeave = useCallback(() => setPos(null), [])

  return (
    <span
      className="ml-1 inline-flex shrink-0 items-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full text-[9px] leading-none transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        ?
      </span>
      {pos &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[9999] w-72 whitespace-pre-line rounded-lg px-3 py-2 text-[11px] leading-relaxed shadow-2xl"
            style={{
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              transform: 'translate(-50%, calc(-100% - 6px))',
              background: 'var(--panel-bg)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '0.5px solid var(--panel-border)',
              color: 'var(--text-primary)',
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}

export function RangeField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  valueSuffix = '',
  disabled = false,
  hint,
}) {
  const precision = getRangePrecision(step)
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="flex flex-col gap-1 text-[13px] font-normal" style={{ color: 'var(--text-primary)' }}>
      <span className="inline-flex items-center">
        {label}
        <HintTooltip text={hint} />
      </span>
      <div className="flex items-center gap-2.5">
        <input
          className={`macos-slider h-[3px] w-full appearance-none rounded-full outline-none ${
            disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
          }`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{
            background: disabled
              ? 'var(--slider-track)'
              : `linear-gradient(to right, var(--accent) ${pct}%, var(--slider-track) ${pct}%)`,
          }}
        />
        <span className="w-14 text-right tabular-nums text-xs" style={{ color: 'var(--text-secondary)' }}>
          {`${value.toFixed(precision)}${valueSuffix}`}
        </span>
      </div>
    </label>
  )
}

export function CheckboxField({ label, checked, onChange, disabled = false, hint }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px] min-w-0" style={{ color: 'var(--text-primary)' }}>
      <span className="inline-flex items-center min-w-0 shrink">
        <span className="truncate">{label}</span>
        <HintTooltip text={hint} />
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200 ${
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
        }`}
        style={{
          background: checked ? 'var(--toggle-on)' : 'var(--slider-track)',
        }}
      >
        <span
          className="absolute top-[2px] h-[14px] w-[14px] rounded-full shadow-sm transition-transform duration-200"
          style={{
            background: '#fff',
            transform: checked ? 'translateX(14px)' : 'translateX(2px)',
          }}
        />
      </button>
    </label>
  )
}

export function ColorField({ label, value, onChange, hint }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px] min-w-0" style={{ color: 'var(--text-primary)' }}>
      <span className="inline-flex items-center min-w-0 shrink">
        <span className="truncate">{label}</span>
        <HintTooltip text={hint} />
      </span>
      <input
        className="h-6 w-10 cursor-pointer rounded-md border-0 p-0"
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ background: 'transparent' }}
      />
    </label>
  )
}

export function SelectField({ label, value, onChange, options, disabled = false, hint }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] min-w-0" style={{ color: 'var(--text-primary)' }}>
      <span className="inline-flex items-center min-w-0">
        <span className="truncate">{label}</span>
        <HintTooltip text={hint} />
      </span>
      <select
        className={`w-full rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors ${
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
        }`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          background: 'var(--input-bg)',
          border: '0.5px solid var(--input-border)',
          color: 'var(--text-primary)',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
