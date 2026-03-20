import { useEffect, useRef, useState } from 'react'

const L = {
  subtitle: {
    ru: 'Симулятор динамики вихрей',
    en: 'Vortex Dynamics Simulator',
  },
  quote_1: {
    ru: 'Создано для служения науке и чистому знанию. Для студентов и профессоров, академиков и прикладников — для всех, кто интересуется механикой сплошных сред, в особенности турбулентными потоками и вихрями, и видит в процессах вихреобразования и их устойчивости фундаментальный механизм, хранящий знание о природе материи.',
    en: 'Created in the service of science and pure knowledge. For students and professors, academics and practitioners — for everyone who is interested in continuum mechanics, especially turbulent flows and vortices, and who sees in the processes of vortex formation and their stability a fundamental mechanism that holds knowledge about the nature of matter.',
  },
  quote_2: {
    ru: 'Для всех, кто задаётся вопросами о том, как Вселенная создаёт и поддерживает эти структуры на всех уровнях организации материи.',
    en: 'For all who ask how the Universe creates and sustains these structures at every level of the organization of matter.',
  },
  author_label: {
    ru: 'Автор',
    en: 'Author',
  },
  dedication: {
    ru: ['Посвящается моей маме ', 'Алёне Борисовне', ' и моей любимой ', 'Наде Рой'],
    en: ['Dedicated to my mother ', 'Alyona Borisovna', ' and my beloved ', 'Nadya Roy'],
  },
  tech_summary_title: {
    ru: 'Техническая сводка',
    en: 'Technical Summary',
  },
  build_info_title: {
    ru: 'Сборка',
    en: 'Build',
  },
  tech_intro: {
    ru: 'TORUS TURBO — симулятор динамики вихрей, реализующий полный VPM-конвейер (метод вихревых частиц) с поддержкой филаментов, подсеточного моделирования, адаптивных численных схем и GPU-ускорения. Предназначен для исследования вихревых колец, турбулентных каскадов, реконнекции и устойчивости вихревых структур.',
    en: 'TORUS TURBO is a vortex dynamics simulator implementing a full VPM pipeline (Vortex Particle Method) with filament support, LES subgrid modeling, adaptive numerical schemes, and GPU acceleration. Designed for studying vortex rings, turbulent cascades, reconnection, and vortex structure stability.',
  },
}

function detectBuildInfo() {
  const isTauri = typeof window !== 'undefined' && !!window.__TAURI__
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMac = /Mac|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua)
  const isLinux = /Linux/.test(ua)

  if (isTauri) {
    const platform = isMac ? (ua.includes('ARM') ? 'macOS · Apple Silicon' : 'macOS · Intel') : isLinux ? 'Linux · x86_64' : 'Desktop'
    return {
      type: 'native',
      compute: { ru: 'Нативный CPU (Rust + rayon) + Нативный GPU (wgpu → Metal/Vulkan)', en: 'Native CPU (Rust + rayon) + Native GPU (wgpu → Metal/Vulkan)' },
      render: { ru: 'Нативный GPU (wgpu)', en: 'Native GPU (wgpu)' },
      platform,
      label: { ru: 'Native CPU + Native GPU', en: 'Native CPU + Native GPU' },
    }
  }

  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu
  return {
    type: 'web',
    compute: hasWebGPU
      ? { ru: 'WebGPU (GPU в браузере) + JS CPU (запасной)', en: 'WebGPU (browser GPU) + JS CPU (fallback)' }
      : { ru: 'JS CPU (однопоточный)', en: 'JS CPU (single-threaded)' },
    render: { ru: 'Three.js (WebGL)', en: 'Three.js (WebGL)' },
    platform: hasWebGPU ? 'WebGPU' : 'CPU',
    label: hasWebGPU ? { ru: 'WebGPU', en: 'WebGPU' } : { ru: 'CPU', en: 'CPU' },
    limitations: hasWebGPU
      ? {
        ru: 'Ограничения веб-версии: песочница браузера, однопоточный JS для CPU-пути, WebGL-рендеринг (не нативный GPU), ограниченная память.',
        en: 'Web version limitations: browser sandbox, single-threaded JS for CPU path, WebGL rendering (not native GPU), limited memory.',
      }
      : {
        ru: 'Ограничения: нет GPU-ускорения, однопоточный JS, ограниченная производительность. Для полной мощности используйте нативную сборку.',
        en: 'Limitations: no GPU acceleration, single-threaded JS, limited performance. Use the native build for full power.',
      },
  }
}

const SECTIONS = {
  ru: [
    {
      title: 'Численные методы',
      items: [
        'Метод вихревых частиц (VPM) — лагранжева бессеточная дискретизация поля завихрённости',
        'Регуляризованный закон Био-Савара: v = Γ/(4π) · (r × ω) / (|r|² + σ²)^(3/2)',
        'Диффузия обмена интенсивностью частиц (PSE) — антисимметричная схема с гауссовым ядром, сохраняющая суммарную циркуляцию',
        'Аналитическое растяжение вихря: (ω·∇)u из градиента регуляризованного Био-Савара',
        'Подсеточная модель Смагоринского: ν_sgs = (C_s·Δ)²·|S|',
        'M\'4-пересетчивание (Монаган, 1985) — кубический интерполяционный фильтр для регуляризации распределения частиц',
        'Удержание завихрённости: f = ε(N × ω), N = ∇|ω| / |∇|ω||',
        'Модель диффузии ядра (расплывание): σ² += 4νdt',
      ],
    },
    {
      title: 'Филаменты',
      items: [
        'Сегментный Био-Савар с регуляризацией + приближение локальной индукции для самоиндуцированной скорости',
        'Адаптивное дробление длинных и слияние коротких сегментов',
        'Вязкая реконнекция — топологический обмен по порогу расстояния и угла',
        'Сглаживание по кривизне и возмущения волнами Кельвина',
        'Пространственная индексация сегментов',
      ],
    },
    {
      title: 'Интеграция по времени',
      items: [
        'Эйлер (O(h)), Рунге-Кутта 2 (O(h²)), Рунге-Кутта 3 (O(h³)) — выбор схемы по требуемой точности',
        'Адаптивный шаг по числу Куранта: dt = C·h / max|v|, C ≈ 0.4',
        'До 16 адаптивных подшагов за такт симуляции',
      ],
    },
    {
      title: 'Ускорение',
      items: [
        'Быстрый мультипольный метод (FMM) — O(N log N), октодерево, θ-критерий Барнса-Хата',
        'Равномерная пространственная сетка с агрегацией дальних ячеек',
        'Автоматический выбор алгоритма: точный ≤ 12K, сетка ≤ 80K, FMM > 80K',
        'GPU-вычислительный конвейер — хеш-сетка с настраиваемым размером корзин, WGSL-шейдеры',
        'Гибридное CPU/GPU исполнение с автоматической балансировкой',
      ],
    },
    {
      title: 'Законы сохранения и диагностика',
      items: [
        'Контроль сохранения энергии E = ½Σ|v|², энстрофии Ω = Σ|ω|², циркуляции Γ = Σγ',
        'Энергетический спектр E(k) по волновым числам',
        'Диагностика кольца: σ/R, наклон, когерентность',
        'Ограничители стабильности с учётом разрушенной энергии',
      ],
    },
    {
      title: 'Визуализация',
      items: [
        'Трёхмерный рендеринг в реальном времени',
        'Поле завихрённости, Q-критерий, поле скоростей',
        'Линии тока и линии траекторий',
        'Экспорт: изображения, метаданные, видео, научные бандлы',
        'Окрашивание филаментов по кривизне',
      ],
    },
    {
      title: 'Платформы',
      items: [
        'macOS (Apple Silicon) — нативный CPU + нативный GPU',
        'macOS (Intel x86_64) — нативный CPU + нативный GPU',
        'Linux (x86_64) — нативный CPU + нативный GPU',
        'Веб (браузер) — JS CPU + WebGPU (Chrome 113+, Edge 113+)',
      ],
    },
    {
      title: 'Технологический стек',
      items: [
        'Интерфейс: React 19, Three.js, Zustand, Tailwind CSS 4, Vite 7',
        'Нативное ядро: Rust (torus-physics, torus-fmm, torus-gpu, torus-bridge)',
        'Настольное приложение: Tauri v2',
        'GPU-вычисления: WGSL-шейдеры, хеш-сетка, wgpu / WebGPU',
      ],
    },
  ],
  en: [
    {
      title: 'Numerical Methods',
      items: [
        'Vortex Particle Method (VPM) — Lagrangian meshless discretization of the vorticity field',
        'Regularized Biot-Savart law: v = Γ/(4π) · (r × ω) / (|r|² + σ²)^(3/2)',
        'PSE diffusion (Particle Strength Exchange) — antisymmetric scheme with Gaussian kernel preserving total circulation',
        'Analytic vortex stretching: (ω·∇)u from the gradient of regularized Biot-Savart',
        'LES Smagorinsky subgrid model: ν_sgs = (C_s·Δ)²·|S|',
        'M\'4 remeshing (Monaghan, 1985) — cubic interpolation filter for particle distribution regularization',
        'Vorticity confinement: f = ε(N × ω), N = ∇|ω| / |∇|ω||',
        'Burgers core-spread diffusion model: σ² += 4νdt',
      ],
    },
    {
      title: 'Filaments',
      items: [
        'Segment Biot-Savart with regularization + LIA (Local Induction Approximation) for self-induced velocity',
        'Adaptive splitting of long segments and merging of short ones',
        'Viscous reconnection — topological swap by distance and angle threshold',
        'Curvature-based smoothing and Kelvin wave perturbation',
        'Spatial segment indexing (segment grid)',
      ],
    },
    {
      title: 'Time Integration',
      items: [
        'Euler (O(h)), RK2 (O(h²)), RK3 (O(h³)) — scheme selection by required accuracy',
        'CFL-adaptive time step: dt = C·h / max|v|, C ≈ 0.4',
        'Up to 16 adaptive substeps per simulation tick',
      ],
    },
    {
      title: 'Acceleration & Optimization',
      items: [
        'Fast Multipole Method (FMM) — O(N log N), octree, Barnes-Hut θ-criterion',
        'Spatial grid — uniform grid with far-cell aggregation',
        'Automatic algorithm selection: exact ≤ 12k, spatialGrid ≤ 80k, FMM > 80k',
        'GPU compute pipeline — hash grid with configurable bucket capacity, WGSL compute shaders',
        'Hybrid CPU/GPU execution with automatic load balancing',
      ],
    },
    {
      title: 'Conservation Laws & Diagnostics',
      items: [
        'Conservation monitoring: energy E = ½Σ|v|², enstrophy Ω = Σ|ω|², circulation Γ = Σγ',
        'Energy spectrum E(k) by wavenumber',
        'Ring diagnostics: σ/R, tilt, coherence',
        'Stability clamps with energy destruction accounting',
      ],
    },
    {
      title: 'Visualization',
      items: [
        'Real-time 3D rendering',
        'Vorticity field, Q-criterion, velocity field',
        'Streamlines and pathlines',
        'Export: images, metadata, video, scientific bundles',
        'Curvature-based coloring for filaments',
      ],
    },
    {
      title: 'Platforms',
      items: [
        'macOS (Apple Silicon) — Native CPU + Native GPU',
        'macOS (Intel x86_64) — Native CPU + Native GPU',
        'Linux (x86_64) — Native CPU + Native GPU',
        'Web (browser) — JS CPU + WebGPU (Chrome 113+, Edge 113+)',
      ],
    },
    {
      title: 'Technology Stack',
      items: [
        'Frontend: React 19, Three.js, Zustand, Tailwind CSS 4, Vite 7',
        'Native core: Rust (torus-physics, torus-fmm, torus-gpu, torus-bridge)',
        'Desktop: Tauri v2',
        'GPU compute: WGSL shaders, hash grid, wgpu / WebGPU',
      ],
    },
  ],
}

function t(key, lang) {
  const entry = L[key]
  if (!entry) return key
  return entry[lang] ?? entry.ru ?? key
}

export default function AboutModal({ open, onClose, language = 'ru' }) {
  const overlayRef = useRef(null)
  const lang = language === 'en' ? 'en' : 'ru'
  const sections = SECTIONS[lang]
  const dedication = L.dedication[lang]
  const [buildInfo] = useState(() => detectBuildInfo())

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-[640px] overflow-y-auto rounded-xl border"
        style={{
          background: '#0c0d1e',
          borderColor: 'rgba(99,102,241,0.2)',
          animation: 'aboutFadeIn 0.3s ease-out',
        }}
      >
        <style>{`
          @keyframes aboutFadeIn {
            from { opacity: 0; transform: translateY(12px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        <button
          onClick={onClose}
          type="button"
          className="absolute right-4 top-4 text-slate-500 hover:text-white transition-colors"
          aria-label="Close"
          style={{ fontSize: 20, lineHeight: 1 }}
        >
          &times;
        </button>

        <div className="p-8">
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: 6,
              color: '#fff',
              textTransform: 'uppercase',
              textShadow: '0 0 30px rgba(99,102,241,0.2)',
            }}
          >
            TORUS TURBO
          </h1>
          <p style={{ fontSize: 13, letterSpacing: 6, color: '#6366F1', marginTop: 4, textTransform: 'uppercase', fontWeight: 600 }}>
            {buildInfo.label[lang]}
          </p>
          <p style={{ fontSize: 12, letterSpacing: 3, color: '#9094c0', marginTop: 2, textTransform: 'uppercase' }}>
            {t('subtitle', lang)}
          </p>

          {/* Build info badge */}
          <div
            style={{
              marginTop: 20,
              padding: '10px 14px',
              background: 'rgba(99,102,241,0.08)',
              borderRadius: 8,
              border: '1px solid rgba(99,102,241,0.15)',
            }}
          >
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, color: '#6366F1', textTransform: 'uppercase', marginBottom: 6 }}>
              {t('build_info_title', lang)}
            </p>
            <div style={{ fontSize: 12, lineHeight: 1.8, color: '#d4d7f0' }}>
              <div><span style={{ color: '#9094c0' }}>{lang === 'ru' ? 'Вычисления: ' : 'Compute: '}</span>{buildInfo.compute[lang]}</div>
              <div><span style={{ color: '#9094c0' }}>{lang === 'ru' ? 'Рендеринг: ' : 'Render: '}</span>{buildInfo.render[lang]}</div>
              {buildInfo.platform && (
                <div><span style={{ color: '#9094c0' }}>{lang === 'ru' ? 'Платформа: ' : 'Platform: '}</span>{buildInfo.platform}</div>
              )}
            </div>
            {buildInfo.limitations && (
              <p style={{ fontSize: 11, lineHeight: 1.6, color: '#7a7eaa', marginTop: 8, fontStyle: 'italic' }}>
                {buildInfo.limitations[lang]}
              </p>
            )}
          </div>

          <div
            style={{
              marginTop: 24,
              paddingLeft: 16,
              borderLeft: '2px solid rgba(99,102,241,0.3)',
            }}
          >
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#b4b8dc', fontStyle: 'italic' }}>
              {t('quote_1', lang)}
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#b4b8dc', fontStyle: 'italic', marginTop: 10 }}>
              {t('quote_2', lang)}
            </p>
            <p style={{ fontSize: 12, color: '#9094c0', marginTop: 14, textAlign: 'right' }}>
              — <span style={{ fontWeight: 600, color: '#d4d7f0' }}>Aries Auro</span>, {t('author_label', lang)}
            </p>
          </div>

          <div
            style={{
              marginTop: 20,
              padding: '12px 16px',
              background: 'rgba(99,102,241,0.06)',
              borderRadius: 8,
              border: '1px solid rgba(99,102,241,0.12)',
            }}
          >
            <p style={{ fontSize: 12, lineHeight: 1.7, color: '#9094c0', textAlign: 'center' }}>
              {dedication[0]}<span style={{ color: '#d4d7f0', fontWeight: 500 }}>{dedication[1]}</span>
              {dedication[2]}<span style={{ color: '#d4d7f0', fontWeight: 500 }}>{dedication[3]}</span>.
            </p>
          </div>

          <div style={{ marginTop: 28, height: 1, background: 'rgba(99,102,241,0.15)' }} />

          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 4,
              color: '#d4d7f0',
              textTransform: 'uppercase',
              marginTop: 24,
            }}
          >
            {t('tech_summary_title', lang)}
          </h2>

          <p style={{ fontSize: 12, lineHeight: 1.7, color: '#9094c0', marginTop: 12 }}>
            {t('tech_intro', lang)}
          </p>

          <div style={{ marginTop: 20 }}>
            {sections.map((section) => (
              <div key={section.title} style={{ marginTop: 18 }}>
                <h3
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 2,
                    color: '#6366F1',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  {section.title}
                </h3>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {section.items.map((item, i) => (
                    <li
                      key={i}
                      style={{
                        fontSize: 12,
                        lineHeight: 1.65,
                        color: '#9094c0',
                        listStyleType: 'disc',
                        marginBottom: 2,
                      }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 28, height: 1, background: 'rgba(99,102,241,0.15)' }} />
          <p style={{ fontSize: 11, color: '#6e72a0', marginTop: 12, textAlign: 'center' }}>
            TORUS TURBO &copy; {new Date().getFullYear()} Aries Auro
          </p>
        </div>
      </div>
    </div>
  )
}
