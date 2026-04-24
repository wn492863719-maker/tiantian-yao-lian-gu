export const BPM_MIN = 30
export const BPM_MAX = 240
export const SESSION_LIMIT = 20
export const MASTER_VOLUME_MIN = 40
export const MASTER_VOLUME_MAX = 180

export const METER_OPTIONS = [
  { value: '2/4', label: '2/4' },
  { value: '3/4', label: '3/4' },
  { value: '4/4', label: '4/4' },
]

export const SUBDIVISION_OPTIONS = [
  { value: 'quarter', label: '四分音符' },
  { value: 'eighth', label: '八分音符' },
  { value: 'triplet', label: '三连音' },
  { value: 'sixteenth', label: '十六分音符' },
]

export const GAP_MODE_OPTIONS = [
  { value: 'off', label: '持续出声', detail: '每小节都打点' },
  { value: '4on1off', label: '4 开 1 关', detail: '4 小节出声 / 1 小节静音' },
  { value: '2on2off', label: '2 开 2 关', detail: '2 小节出声 / 2 小节静音' },
]

export const RAMP_INTERVAL_OPTIONS = [
  { value: 15, label: '15 秒' },
  { value: 30, label: '30 秒' },
  { value: 45, label: '45 秒' },
  { value: 60, label: '60 秒' },
]

export const RAMP_STEP_OPTIONS = [
  { value: 1, label: '+1 BPM' },
  { value: 2, label: '+2 BPM' },
  { value: 3, label: '+3 BPM' },
  { value: 5, label: '+5 BPM' },
]

export const SOUND_SET_OPTIONS = [
  { value: 'classic', label: '经典 Click', detail: '清晰、稳、最通用' },
  { value: 'deep', label: '厚击 Click', detail: '更扎实，低频更厚' },
  { value: 'pulse', label: '明亮 Beep', detail: '更穿透，手机外放更显' },
  { value: 'voiceZh', label: '人声 1 2 3 4', detail: '中文数拍，主拍直接听到' },
  { value: 'voiceEn', label: 'Voice Count', detail: 'one two three four' },
]

export const DEFAULT_PRACTICE_CONFIG = {
  bpm: 72,
  meter: '4/4',
  subdivision: 'quarter',
  accentBeat: null,
  gapMode: 'off',
  rampEnabled: true,
  rampIntervalSec: 30,
  rampStepBpm: 2,
  soundSet: 'classic',
  masterVolume: 110,
}

const BEATS_PER_BAR = {
  '2/4': 2,
  '3/4': 3,
  '4/4': 4,
}

const SUBDIVISION_FACTOR = {
  quarter: 1,
  eighth: 2,
  triplet: 3,
  sixteenth: 4,
}

const VALID_GAP_MODES = new Set(GAP_MODE_OPTIONS.map((option) => option.value))
const VALID_METERS = new Set(METER_OPTIONS.map((option) => option.value))
const VALID_SUBDIVISIONS = new Set(
  SUBDIVISION_OPTIONS.map((option) => option.value),
)
const VALID_SOUND_SETS = new Set(SOUND_SET_OPTIONS.map((option) => option.value))

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getBeatsPerBar(meter) {
  return BEATS_PER_BAR[meter] ?? BEATS_PER_BAR[DEFAULT_PRACTICE_CONFIG.meter]
}

export function getSubdivisionFactor(subdivision) {
  return (
    SUBDIVISION_FACTOR[subdivision] ??
    SUBDIVISION_FACTOR[DEFAULT_PRACTICE_CONFIG.subdivision]
  )
}

export function getAvailableAccentBeats(meter) {
  const beatsPerBar = getBeatsPerBar(meter)

  return Array.from({ length: Math.max(0, beatsPerBar - 1) }, (_, index) => index + 2)
}

export function normalizeConfig(rawConfig = {}) {
  const nextConfig = {
    ...DEFAULT_PRACTICE_CONFIG,
    ...rawConfig,
  }

  const meter = VALID_METERS.has(nextConfig.meter)
    ? nextConfig.meter
    : DEFAULT_PRACTICE_CONFIG.meter
  const subdivision = VALID_SUBDIVISIONS.has(nextConfig.subdivision)
    ? nextConfig.subdivision
    : DEFAULT_PRACTICE_CONFIG.subdivision
  const gapMode = VALID_GAP_MODES.has(nextConfig.gapMode)
    ? nextConfig.gapMode
    : DEFAULT_PRACTICE_CONFIG.gapMode
  const bpm = Math.round(
    clamp(toFiniteNumber(nextConfig.bpm, DEFAULT_PRACTICE_CONFIG.bpm), BPM_MIN, BPM_MAX),
  )
  const rampIntervalSec = Math.round(
    clamp(
      toFiniteNumber(nextConfig.rampIntervalSec, DEFAULT_PRACTICE_CONFIG.rampIntervalSec),
      5,
      300,
    ),
  )
  const rampStepBpm = Math.round(
    clamp(
      toFiniteNumber(nextConfig.rampStepBpm, DEFAULT_PRACTICE_CONFIG.rampStepBpm),
      1,
      20,
    ),
  )
  const soundSet = VALID_SOUND_SETS.has(nextConfig.soundSet)
    ? nextConfig.soundSet
    : DEFAULT_PRACTICE_CONFIG.soundSet
  const masterVolume = Math.round(
    clamp(
      toFiniteNumber(nextConfig.masterVolume, DEFAULT_PRACTICE_CONFIG.masterVolume),
      MASTER_VOLUME_MIN,
      MASTER_VOLUME_MAX,
    ),
  )

  const availableAccentBeats = getAvailableAccentBeats(meter)
  const accentBeat = availableAccentBeats.includes(Number(nextConfig.accentBeat))
    ? Number(nextConfig.accentBeat)
    : null

  return {
    bpm,
    meter,
    subdivision,
    accentBeat,
    gapMode,
    rampEnabled: Boolean(nextConfig.rampEnabled),
    rampIntervalSec,
    rampStepBpm,
    soundSet,
    masterVolume,
  }
}

export function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

export function formatSessionStamp(isoString) {
  const date = new Date(isoString)

  if (Number.isNaN(date.getTime())) {
    return '时间未知'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
