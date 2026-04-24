import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createMetronomeEngine } from './audio/metronome.js'
import {
  GAP_MODE_OPTIONS,
  MASTER_VOLUME_MAX,
  MASTER_VOLUME_MIN,
  METER_OPTIONS,
  RAMP_INTERVAL_OPTIONS,
  RAMP_STEP_OPTIONS,
  SOUND_SET_OPTIONS,
  SUBDIVISION_OPTIONS,
  formatDuration,
  formatSessionStamp,
  getAvailableAccentBeats,
  getBeatsPerBar,
  normalizeConfig,
} from './utils/practice.js'
import {
  hasSavedSettings,
  loadSessions,
  loadSettings,
  saveSession,
  saveSettings,
} from './utils/storage.js'

function SectionCard({ eyebrow, title, description, children }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {description ? <p className="card-description">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function MetricPill({ label, value, accent = false }) {
  return (
    <div className={`metric-pill${accent ? ' accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function OptionGrid({ options, value, onSelect, columns = 3 }) {
  return (
    <div className="option-grid" style={{ '--columns': columns }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`option-chip${value === option.value ? ' active' : ''}`}
          onClick={() => onSelect(option.value)}
        >
          <strong>{option.label}</strong>
          {option.detail ? <span>{option.detail}</span> : null}
        </button>
      ))}
    </div>
  )
}

function SessionItem({ session }) {
  return (
    <li className="session-item">
      <div>
        <strong>{formatSessionStamp(session.startedAt)}</strong>
        <span>
          {session.configSnapshot.meter} ·{' '}
          {
            SUBDIVISION_OPTIONS.find(
              (option) => option.value === session.configSnapshot.subdivision,
            )?.label
          }
        </span>
      </div>
      <div className="session-meta">
        <span>{formatDuration(session.durationSec)}</span>
        <span>
          {session.startBpm}→{session.endBpm} BPM
        </span>
        <span>最高 {session.maxReachedBpm} BPM</span>
      </div>
    </li>
  )
}

function App() {
  const [{ restoredSettings, startingConfig }] = useState(() => ({
    restoredSettings: hasSavedSettings(),
    startingConfig: loadSettings(),
  }))
  const engineRef = useRef(null)
  const sessionRef = useRef(null)

  const [config, setConfig] = useState(startingConfig)
  const [sessions, setSessions] = useState(() => loadSessions())
  const [engineState, setEngineState] = useState({
    status: 'idle',
    config: startingConfig,
    currentBpm: startingConfig.bpm,
    beatInBar: 1,
    subdivisionPulse: 1,
    barCount: 1,
    audibleBar: true,
    elapsedSec: 0,
    isAudioReady: false,
  })
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const engine = createMetronomeEngine()
    engineRef.current = engine

    const unsubscribe = engine.subscribe((snapshot) => {
      setEngineState(snapshot)
    })

    return () => {
      unsubscribe()
      void engine.dispose()
    }
  }, [])

  useEffect(() => {
    saveSettings(config)
  }, [config])

  useEffect(() => {
    if (!sessionRef.current) {
      return
    }

    if (engineState.status === 'running' || engineState.status === 'paused') {
      sessionRef.current.maxReachedBpm = Math.max(
        sessionRef.current.maxReachedBpm,
        Math.round(engineState.currentBpm),
      )
    }
  }, [engineState.currentBpm, engineState.status])

  const availableAccentBeats = useMemo(
    () => getAvailableAccentBeats(config.meter),
    [config.meter],
  )
  const beatMarkers = useMemo(
    () => Array.from({ length: getBeatsPerBar(config.meter) }, (_, index) => index + 1),
    [config.meter],
  )
  const latestSessions = useMemo(() => sessions.slice(0, 5), [sessions])

  const updateConfig = (patch) => {
    setConfig((previousConfig) => {
      const nextConfig = normalizeConfig({
        ...previousConfig,
        ...patch,
      })
      engineRef.current?.updateConfig(nextConfig)
      return nextConfig
    })
  }

  const adjustBpm = (delta) => {
    updateConfig({
      bpm: config.bpm + delta,
    })
  }

  const handleBpmInput = (event) => {
    const nextValue = Number(event.target.value)

    if (!Number.isFinite(nextValue)) {
      return
    }

    updateConfig({
      bpm: nextValue,
    })
  }

  const handleVolumeInput = (event) => {
    const nextValue = Number(event.target.value)

    if (!Number.isFinite(nextValue)) {
      return
    }

    updateConfig({
      masterVolume: nextValue,
    })
  }

  const handleStart = async () => {
    if (!engineRef.current) {
      return
    }

    try {
      setErrorMessage('')
      const startedAt = new Date().toISOString()
      await engineRef.current.start(config)
      sessionRef.current = {
        startedAt,
        startBpm: config.bpm,
        maxReachedBpm: config.bpm,
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '启动音频失败，请重试。')
    }
  }

  const handlePause = () => {
    engineRef.current?.pause()
  }

  const handleResume = async () => {
    if (!engineRef.current) {
      return
    }

    try {
      setErrorMessage('')
      await engineRef.current.resume()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '恢复音频失败，请重试。')
    }
  }

  const handleStop = () => {
    if (!engineRef.current) {
      return
    }

    const finalSnapshot = engineRef.current.stop()

    if (sessionRef.current && finalSnapshot.elapsedSec >= 1) {
      const record = {
        startedAt: sessionRef.current.startedAt,
        endedAt: new Date().toISOString(),
        durationSec: finalSnapshot.elapsedSec,
        startBpm: sessionRef.current.startBpm,
        endBpm: Math.round(finalSnapshot.currentBpm),
        maxReachedBpm: sessionRef.current.maxReachedBpm,
        configSnapshot: config,
      }

      setSessions(saveSession(record))
    }

    sessionRef.current = null
  }

  const statusLabel =
    engineState.status === 'running'
      ? '进行中'
      : engineState.status === 'paused'
        ? '已暂停'
        : '待开始'

  const accentLabel = config.accentBeat ? `第 ${config.accentBeat} 拍加重` : '仅第一拍重音'
  const gapLabel = GAP_MODE_OPTIONS.find((option) => option.value === config.gapMode)?.label
  const subdivisionLabel = SUBDIVISION_OPTIONS.find(
    (option) => option.value === config.subdivision,
  )?.label
  const soundLabel = SOUND_SET_OPTIONS.find((option) => option.value === config.soundSet)?.label

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="kicker">Practice Every Day</p>
          <h1>天天要练鼓</h1>
          <p className="hero-text">
            一页打开就能练。现在加了更多 click 音色、中文和英文人声数拍，还有一个能安全推大的超大音量滑杆。
          </p>
        </div>

        <div className="hero-metrics">
          <MetricPill label="状态" value={statusLabel} accent />
          <MetricPill label="实时 BPM" value={`${Math.round(engineState.currentBpm)}`} />
          <MetricPill label="练习时长" value={formatDuration(engineState.elapsedSec)} />
          <MetricPill label="当前小节" value={`第 ${engineState.barCount} 小节`} />
        </div>
      </header>

      <main className="content-grid">
        <SectionCard
          eyebrow="Transport"
          title="练习控制"
          description="开始前不自动发声。首次点击“开始练习”时才会创建音频上下文。"
        >
          <div className="transport-status">
            <div>
              <span className={`status-dot ${engineState.status}`}></span>
              <strong>{statusLabel}</strong>
            </div>
            <p>
              {engineState.audibleBar ? '当前为出声小节' : '当前为静音小节'} ·{' '}
              {config.meter} · {subdivisionLabel}
            </p>
          </div>

          <div className="beat-rail" aria-label="当前拍位">
            {beatMarkers.map((beat) => {
              const isActive = engineState.beatInBar === beat && engineState.status !== 'idle'
              const isPrimary = beat === 1
              const isAccent = config.accentBeat === beat

              return (
                <div
                  key={beat}
                  className={`beat-node${isActive ? ' active' : ''}${isPrimary ? ' primary' : ''}${
                    isAccent ? ' accent' : ''
                  }`}
                >
                  <span>{beat}</span>
                </div>
              )
            })}
          </div>

          <div className="transport-meta">
            <MetricPill label="音色" value={soundLabel} />
            <MetricPill label="重音" value={accentLabel} />
            <MetricPill label="Gap" value={gapLabel} />
            <MetricPill label="音量" value={`${config.masterVolume}%`} />
            <MetricPill
              label="渐进提速"
              value={
                config.rampEnabled
                  ? `${config.rampIntervalSec} 秒 +${config.rampStepBpm}`
                  : '已关闭'
              }
            />
          </div>

          <p className="inline-hint">
            运行中修改参数会在下一小节开始时接管，避免中途跳拍。
          </p>
        </SectionCard>

        <SectionCard
          eyebrow="Sound"
          title="音色与超大音量"
          description="切换不同 click，或直接让节拍器开口数拍。100% 以上会启用增益提升和压缩保护。"
        >
          <div className="field-group">
            <label>音色</label>
            <OptionGrid
              options={SOUND_SET_OPTIONS}
              value={config.soundSet}
              onSelect={(value) => updateConfig({ soundSet: value })}
              columns={2}
            />
          </div>

          <div className="volume-card">
            <div className="volume-head">
              <div>
                <p className="volume-label">超大音量</p>
                <strong>{config.masterVolume}%</strong>
              </div>
              <span>{config.masterVolume > 100 ? '增益提升中' : '标准电平'}</span>
            </div>

            <input
              className="volume-slider"
              type="range"
              min={MASTER_VOLUME_MIN}
              max={MASTER_VOLUME_MAX}
              step="1"
              value={config.masterVolume}
              onChange={handleVolumeInput}
              aria-label="超大音量滑杆"
            />

            <div className="volume-presets">
              {[90, 110, 140, 180].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={config.masterVolume === value ? 'active' : ''}
                  onClick={() => updateConfig({ masterVolume: value })}
                >
                  {value}%
                </button>
              ))}
            </div>
          </div>

          <p className="inline-hint">
            人声数拍会在每拍开头播报 1 2 3 4 或 one two three four；如果你开了八分、三连音或十六分，细分会继续用轻 click 补齐。
          </p>
        </SectionCard>

        <SectionCard eyebrow="Tempo" title="速度" description="支持 30 到 240 BPM。">
          <div className="tempo-panel">
            <div className="tempo-display">
              <button type="button" className="tempo-step" onClick={() => adjustBpm(-1)}>
                -1
              </button>
              <div>
                <strong>{config.bpm}</strong>
                <span>BPM</span>
              </div>
              <button type="button" className="tempo-step" onClick={() => adjustBpm(1)}>
                +1
              </button>
            </div>

            <input
              type="range"
              min="30"
              max="240"
              step="1"
              value={config.bpm}
              onChange={handleBpmInput}
              aria-label="BPM 滑杆"
            />

            <div className="tempo-footer">
              <label className="number-field">
                <span>手动输入</span>
                <input
                  type="number"
                  min="30"
                  max="240"
                  step="1"
                  value={config.bpm}
                  onChange={handleBpmInput}
                />
              </label>

              <div className="quick-presets">
                {[60, 90, 120].map((value) => (
                  <button key={value} type="button" onClick={() => updateConfig({ bpm: value })}>
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Feel"
          title="拍号与细分"
          description="MVP 先把简单拍做稳，练习时最常用的四种细分都在这里。"
        >
          <div className="field-group">
            <label>拍号</label>
            <OptionGrid
              options={METER_OPTIONS}
              value={config.meter}
              onSelect={(value) => updateConfig({ meter: value })}
              columns={3}
            />
          </div>

          <div className="field-group">
            <label>细分</label>
            <OptionGrid
              options={SUBDIVISION_OPTIONS}
              value={config.subdivision}
              onSelect={(value) => updateConfig({ subdivision: value })}
              columns={2}
            />
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Accent"
          title="重音"
          description="默认每小节第一拍重音，再额外选 1 个拍位做位置感训练。"
        >
          <div className="field-group">
            <label>附加重音</label>
            <OptionGrid
              options={[
                { value: 'none', label: '仅第一拍', detail: '不加额外重音' },
                ...availableAccentBeats.map((beat) => ({
                  value: String(beat),
                  label: `第 ${beat} 拍`,
                  detail: '额外加重',
                })),
              ]}
              value={config.accentBeat ? String(config.accentBeat) : 'none'}
              onSelect={(value) =>
                updateConfig({
                  accentBeat: value === 'none' ? null : Number(value),
                })
              }
              columns={Math.min(availableAccentBeats.length + 1, 3)}
            />
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Gap"
          title="Gap Click"
          description="静音小节只关声音，不停内部计数，恢复出声时仍对准落点。"
        >
          <OptionGrid
            options={GAP_MODE_OPTIONS}
            value={config.gapMode}
            onSelect={(value) => updateConfig({ gapMode: value })}
            columns={1}
          />
        </SectionCard>

        <SectionCard
          eyebrow="Ramp"
          title="渐进提速"
          description="参数变化从下一小节生效；暂停时冻结，继续后接着往上推。"
        >
          <button
            type="button"
            className={`toggle-strip${config.rampEnabled ? ' on' : ''}`}
            onClick={() => updateConfig({ rampEnabled: !config.rampEnabled })}
          >
            <span>渐进提速</span>
            <strong>{config.rampEnabled ? '已开启' : '已关闭'}</strong>
          </button>

          <div className={`ramp-grid${config.rampEnabled ? '' : ' disabled'}`}>
            <div className="field-group">
              <label>间隔</label>
              <OptionGrid
                options={RAMP_INTERVAL_OPTIONS}
                value={config.rampIntervalSec}
                onSelect={(value) => updateConfig({ rampIntervalSec: value })}
                columns={2}
              />
            </div>

            <div className="field-group">
              <label>每次增加</label>
              <OptionGrid
                options={RAMP_STEP_OPTIONS}
                value={config.rampStepBpm}
                onSelect={(value) => updateConfig({ rampStepBpm: value })}
                columns={2}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Session"
          title="本地记录"
          description="自动保存上次配置和最近 20 次练习摘要，方便你回到同一套训练。"
        >
          <div className="session-overview">
            <MetricPill
              label="配置恢复"
              value={restoredSettings ? '已恢复上次设置' : '当前为默认设置'}
            />
            <MetricPill label="已记录" value={`${sessions.length} 次`} />
            <MetricPill
              label="音频上下文"
              value={engineState.isAudioReady ? '已准备' : '等待首次点击'}
            />
          </div>

          {latestSessions.length > 0 ? (
            <ul className="session-list">
              {latestSessions.map((session) => (
                <SessionItem
                  key={`${session.startedAt}-${session.endedAt}`}
                  session={session}
                />
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <strong>还没有练习记录</strong>
              <p>先跑一次完整练习，停止后就会自动写入本地摘要。</p>
            </div>
          )}
        </SectionCard>
      </main>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <footer className="transport-dock">
        <div className="dock-copy">
          <strong>
            {engineState.status === 'running'
              ? `第 ${engineState.barCount} 小节 · 第 ${engineState.beatInBar} 拍`
              : '准备好就点开始'}
          </strong>
          <span>iPhone 首次进入请先点一次“开始练习”。如果切到人声数拍，第一次加载会比纯 click 稍慢一点。</span>
        </div>

        <div className="dock-actions">
          {engineState.status === 'idle' ? (
            <button type="button" className="primary-action" onClick={handleStart}>
              开始练习
            </button>
          ) : null}

          {engineState.status === 'running' ? (
            <button type="button" className="primary-action" onClick={handlePause}>
              暂停
            </button>
          ) : null}

          {engineState.status === 'paused' ? (
            <button type="button" className="primary-action" onClick={handleResume}>
              继续
            </button>
          ) : null}

          {engineState.status !== 'idle' ? (
            <button type="button" className="secondary-action" onClick={handleStop}>
              停止并记录
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  )
}

export default App
