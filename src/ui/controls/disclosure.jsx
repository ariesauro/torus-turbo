import { useState } from 'react'
import { HintTooltip } from './fields'

export function DisclosureSection({ title, description = '', defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section
      className="rounded-lg p-3"
      style={{
        background: 'var(--section-bg)',
        border: '0.5px solid var(--section-border)',
      }}
    >
      <button
        className="flex w-full cursor-pointer select-none items-center justify-between text-left text-[13px] font-semibold tracking-wide transition-colors"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        style={{ color: '#e8eafc' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#e8eafc' }}
      >
        <span>{title}</span>
        <span
          className="text-[9px] transition-transform duration-200"
          style={{
            color: 'var(--text-secondary)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
          }}
        >
          ▼
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-200 ease-out ${
          isOpen ? 'mt-2.5 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {description ? (
            <p className="mb-2.5 text-xs leading-relaxed" style={{ color: '#b4b8dc' }}>
              {description}
            </p>
          ) : null}
          <div className="space-y-2">{children}</div>
        </div>
      </div>
    </section>
  )
}

export function InlineDisclosure({ title, defaultOpen = false, hint, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div
      className="rounded-md px-2.5 py-1.5"
      style={{
        background: 'rgba(var(--section-bg), 0.5)',
        border: '0.5px solid var(--section-border)',
      }}
    >
      <button
        className="flex w-full cursor-pointer select-none items-center justify-between text-left text-xs font-medium tracking-wide transition-colors"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        style={{ color: '#d4d7f0' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#f4f5ff' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#d4d7f0' }}
      >
        <span className="inline-flex items-center">
          {title}
          <HintTooltip text={hint} />
        </span>
        <span
          className="text-[9px] transition-transform duration-200"
          style={{
            color: 'var(--text-secondary)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
          }}
        >
          ▼
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-200 ease-out ${
          isOpen ? 'mt-2 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2">{children}</div>
        </div>
      </div>
    </div>
  )
}
