export function MathVar({ children }) {
  return <span className="font-serif italic">{children}</span>
}

export function Fraction({ numerator, denominator }) {
  return (
    <span className="mx-0.5 inline-flex min-w-[2.25rem] flex-col items-center align-middle leading-none">
      <span className="border-b border-slate-400 px-1 pb-0.5 text-center">{numerator}</span>
      <span className="px-1 pt-0.5 text-center">{denominator}</span>
    </span>
  )
}

export function Formula({ children }) {
  return <p className="text-[11px] text-slate-300">{children}</p>
}
