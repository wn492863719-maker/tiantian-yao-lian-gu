import {
  DEFAULT_PRACTICE_CONFIG,
  BPM_MAX,
  BPM_MIN,
  getBeatsPerBar,
  getSubdivisionFactor,
  normalizeConfig,
} from '../utils/practice.js'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_SEC = 0.1
const START_DELAY_SEC = 0.06
const MIN_GAIN = 0.0001
const BASE_URL = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

const VOICE_SOUND_SETS = new Set(['voiceZh', 'voiceEn'])
const VOICE_SAMPLE_URLS = {
  voiceZh: {
    1: `${BASE_URL}audio/count-zh-1.wav`,
    2: `${BASE_URL}audio/count-zh-2.wav`,
    3: `${BASE_URL}audio/count-zh-3.wav`,
    4: `${BASE_URL}audio/count-zh-4.wav`,
  },
  voiceEn: {
    1: `${BASE_URL}audio/count-en-1.wav`,
    2: `${BASE_URL}audio/count-en-2.wav`,
    3: `${BASE_URL}audio/count-en-3.wav`,
    4: `${BASE_URL}audio/count-en-4.wav`,
  },
}

function buildSnapshot(config, overrides = {}) {
  return {
    status: 'idle',
    config,
    isAudioReady: false,
    currentBpm: config.bpm,
    beatInBar: 1,
    subdivisionPulse: 1,
    barCount: 1,
    audibleBar: true,
    elapsedSec: 0,
    ...overrides,
  }
}

function isBarAudible(barIndex, gapMode) {
  if (gapMode === '4on1off') {
    return barIndex % 5 < 4
  }

  if (gapMode === '2on2off') {
    return barIndex % 4 < 2
  }

  return true
}

function getMasterGainValue(masterVolume) {
  if (masterVolume <= 100) {
    return masterVolume / 100
  }

  return 1 + ((masterVolume - 100) / 80) * 0.6
}

function getSynthProfile(soundSet, isBeatStart, isPrimaryAccent, isCustomAccent) {
  const profiles = {
    classic: {
      subdivision: { waveform: 'sine', frequency: 920, endFrequency: 740, peakGain: 0.14, duration: 0.03 },
      beat: { waveform: 'triangle', frequency: 1260, endFrequency: 920, peakGain: 0.22, duration: 0.04 },
      accent: { waveform: 'triangle', frequency: 1540, endFrequency: 1140, peakGain: 0.28, duration: 0.045 },
      downbeat: { waveform: 'triangle', frequency: 1940, endFrequency: 1320, peakGain: 0.4, duration: 0.052 },
    },
    deep: {
      subdivision: { waveform: 'triangle', frequency: 600, endFrequency: 420, peakGain: 0.16, duration: 0.032 },
      beat: { waveform: 'triangle', frequency: 860, endFrequency: 600, peakGain: 0.24, duration: 0.042 },
      accent: { waveform: 'triangle', frequency: 1040, endFrequency: 720, peakGain: 0.32, duration: 0.05 },
      downbeat: { waveform: 'triangle', frequency: 1280, endFrequency: 860, peakGain: 0.44, duration: 0.058 },
    },
    pulse: {
      subdivision: { waveform: 'square', frequency: 1320, endFrequency: 980, peakGain: 0.12, duration: 0.024 },
      beat: { waveform: 'square', frequency: 1720, endFrequency: 1320, peakGain: 0.2, duration: 0.032 },
      accent: { waveform: 'square', frequency: 2040, endFrequency: 1540, peakGain: 0.26, duration: 0.038 },
      downbeat: { waveform: 'square', frequency: 2280, endFrequency: 1660, peakGain: 0.36, duration: 0.046 },
    },
  }

  const family = profiles[soundSet] ?? profiles.classic

  if (!isBeatStart) {
    return family.subdivision
  }

  if (isPrimaryAccent) {
    return family.downbeat
  }

  if (isCustomAccent) {
    return family.accent
  }

  return family.beat
}

export function createMetronomeEngine() {
  let audioContext = null
  let schedulerTimerId = null
  let activeConfig = normalizeConfig(DEFAULT_PRACTICE_CONFIG)
  let desiredConfig = activeConfig
  let pendingConfig = null
  let state = buildSnapshot(desiredConfig)
  let nextNoteTime = 0
  let currentStepInBar = 0
  let currentBarNumber = 1
  let currentBarBpm = desiredConfig.bpm
  let activeSegmentStartedAt = 0
  let accumulatedRunSec = 0
  let lastUiEmitAt = 0
  let masterGainNode = null
  let compressorNode = null
  let safetyGainNode = null
  let voiceAssetPromise = null

  const subscribers = new Set()
  const scheduledVoices = new Set()
  const visualTimers = new Set()
  const sampleBufferCache = new Map()

  function notify() {
    const snapshot = getSnapshot()
    subscribers.forEach((listener) => listener(snapshot))
  }

  function setState(patch) {
    state = {
      ...state,
      ...patch,
    }
    notify()
  }

  function clearVisualTimers() {
    visualTimers.forEach((timerId) => window.clearTimeout(timerId))
    visualTimers.clear()
  }

  function stopScheduledVoices() {
    const now = audioContext?.currentTime ?? 0

    scheduledVoices.forEach((voice) => {
      try {
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(MIN_GAIN, now)
        voice.source.stop(now)
      } catch {
        // Ignore sources that already ended.
      }
    })
  }

  function clearScheduler() {
    if (schedulerTimerId) {
      window.clearInterval(schedulerTimerId)
      schedulerTimerId = null
    }
  }

  function getElapsedAt(time) {
    if (state.status !== 'running') {
      return accumulatedRunSec
    }

    return accumulatedRunSec + Math.max(0, time - activeSegmentStartedAt)
  }

  function resolveBarBpm(barStartTime) {
    if (!activeConfig.rampEnabled) {
      return activeConfig.bpm
    }

    const rampCount = Math.floor(getElapsedAt(barStartTime) / activeConfig.rampIntervalSec)
    return Math.min(BPM_MAX, activeConfig.bpm + rampCount * activeConfig.rampStepBpm)
  }

  function maybeEmitElapsed(force = false) {
    if (!audioContext || state.status !== 'running') {
      return
    }

    const now = performance.now()

    if (!force && now - lastUiEmitAt < 250) {
      return
    }

    lastUiEmitAt = now

    setState({
      elapsedSec: getElapsedAt(audioContext.currentTime),
    })
  }

  function queueVisualUpdate(detail, when) {
    const delayMs = Math.max(0, (when - audioContext.currentTime) * 1000)
    const timerId = window.setTimeout(() => {
      visualTimers.delete(timerId)

      if (state.status !== 'running') {
        return
      }

      setState({
        beatInBar: detail.beatInBar,
        subdivisionPulse: detail.subdivisionPulse,
        barCount: detail.barCount,
        audibleBar: detail.audibleBar,
        currentBpm: detail.currentBpm,
        elapsedSec: detail.elapsedSec,
      })
    }, delayMs)

    visualTimers.add(timerId)
  }

  function ensureOutputChain(context) {
    if (masterGainNode && compressorNode && safetyGainNode) {
      return
    }

    masterGainNode = context.createGain()
    compressorNode = context.createDynamicsCompressor()
    safetyGainNode = context.createGain()

    compressorNode.threshold.value = -14
    compressorNode.knee.value = 18
    compressorNode.ratio.value = 12
    compressorNode.attack.value = 0.002
    compressorNode.release.value = 0.09
    safetyGainNode.gain.value = 0.94

    masterGainNode.connect(compressorNode)
    compressorNode.connect(safetyGainNode)
    safetyGainNode.connect(context.destination)
  }

  function applyMasterVolume(masterVolume, immediate = false) {
    if (!audioContext || !masterGainNode) {
      return
    }

    const now = audioContext.currentTime
    const nextGain = getMasterGainValue(masterVolume)

    masterGainNode.gain.cancelScheduledValues(now)

    if (immediate) {
      masterGainNode.gain.setValueAtTime(nextGain, now)
      return
    }

    masterGainNode.gain.setTargetAtTime(nextGain, now, 0.012)
  }

  function trimBuffer(buffer) {
    if (!audioContext) {
      return buffer
    }

    const threshold = 0.012
    const padding = Math.floor(buffer.sampleRate * 0.008)
    let start = 0
    let end = buffer.length - 1

    findStart: for (let index = 0; index < buffer.length; index += 1) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        if (Math.abs(buffer.getChannelData(channel)[index]) > threshold) {
          start = Math.max(0, index - padding)
          break findStart
        }
      }
    }

    findEnd: for (let index = buffer.length - 1; index >= 0; index -= 1) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        if (Math.abs(buffer.getChannelData(channel)[index]) > threshold) {
          end = Math.min(buffer.length - 1, index + padding)
          break findEnd
        }
      }
    }

    if (end <= start) {
      return buffer
    }

    const trimmedLength = end - start + 1
    const trimmedBuffer = audioContext.createBuffer(
      buffer.numberOfChannels,
      trimmedLength,
      buffer.sampleRate,
    )

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const sourceData = buffer.getChannelData(channel).subarray(start, end + 1)
      trimmedBuffer.copyToChannel(sourceData, channel)
    }

    return trimmedBuffer
  }

  async function loadAudioBuffer(url) {
    if (sampleBufferCache.has(url)) {
      return sampleBufferCache.get(url)
    }

    const bufferPromise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`无法加载音频资源：${url}`)
        }

        return response.arrayBuffer()
      })
      .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
      .then((buffer) => trimBuffer(buffer))

    sampleBufferCache.set(url, bufferPromise)

    return bufferPromise
  }

  async function ensureVoiceAssets() {
    if (!audioContext) {
      return
    }

    if (!voiceAssetPromise) {
      const urls = Object.values(VOICE_SAMPLE_URLS).flatMap((soundSet) => Object.values(soundSet))
      voiceAssetPromise = Promise.all(urls.map((url) => loadAudioBuffer(url)))
    }

    await voiceAssetPromise
  }

  function registerScheduledVoice(source, gain) {
    const voice = { source, gain }

    scheduledVoices.add(voice)

    source.onended = () => {
      scheduledVoices.delete(voice)
      source.disconnect()
      gain.disconnect()
    }
  }

  function queueSynthClick({ when, soundSet, isBeatStart, isPrimaryAccent, isCustomAccent }) {
    if (!audioContext || !masterGainNode) {
      return
    }

    const profile = getSynthProfile(soundSet, isBeatStart, isPrimaryAccent, isCustomAccent)
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscillator.type = profile.waveform
    oscillator.frequency.setValueAtTime(profile.frequency, when)
    oscillator.frequency.exponentialRampToValueAtTime(profile.endFrequency, when + profile.duration)

    gain.gain.setValueAtTime(MIN_GAIN, when)
    gain.gain.exponentialRampToValueAtTime(profile.peakGain, when + 0.003)
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + profile.duration)

    oscillator.connect(gain)
    gain.connect(masterGainNode)

    registerScheduledVoice(oscillator, gain)

    oscillator.start(when)
    oscillator.stop(when + profile.duration + 0.012)
  }

  async function getVoiceBuffer(soundSet, beatInBar) {
    const sampleUrl = VOICE_SAMPLE_URLS[soundSet]?.[beatInBar]

    if (!sampleUrl) {
      return null
    }

    return loadAudioBuffer(sampleUrl)
  }

  async function queueVoiceCount({ when, soundSet, beatInBar, isPrimaryAccent, isCustomAccent }) {
    if (!audioContext || !masterGainNode) {
      return
    }

    const buffer = await getVoiceBuffer(soundSet, beatInBar)

    if (!buffer) {
      return
    }

    const source = audioContext.createBufferSource()
    const gain = audioContext.createGain()
    const voiceGain = isPrimaryAccent ? 0.96 : isCustomAccent ? 0.88 : 0.8

    source.buffer = buffer
    source.playbackRate.setValueAtTime(soundSet === 'voiceEn' ? 1.04 : 1.08, when)

    gain.gain.setValueAtTime(MIN_GAIN, when)
    gain.gain.exponentialRampToValueAtTime(voiceGain, when + 0.01)
    gain.gain.setTargetAtTime(MIN_GAIN, when + Math.max(buffer.duration * 0.72, 0.09), 0.045)

    source.connect(gain)
    gain.connect(masterGainNode)

    registerScheduledVoice(source, gain)

    source.start(when)
    source.stop(when + buffer.duration + 0.04)
  }

  function applyPendingConfigIfNeeded() {
    if (currentStepInBar !== 0 || !pendingConfig) {
      return
    }

    activeConfig = pendingConfig
    pendingConfig = null
    applyMasterVolume(activeConfig.masterVolume)
  }

  function schedulePulse() {
    applyPendingConfigIfNeeded()

    const pulsesPerBeat = getSubdivisionFactor(activeConfig.subdivision)
    const beatsPerBar = getBeatsPerBar(activeConfig.meter)
    const stepsPerBar = pulsesPerBeat * beatsPerBar

    if (currentStepInBar === 0) {
      currentBarBpm = resolveBarBpm(nextNoteTime)
    }

    const beatInBar = Math.floor(currentStepInBar / pulsesPerBeat) + 1
    const subdivisionPulse = (currentStepInBar % pulsesPerBeat) + 1
    const barIndex = currentBarNumber - 1
    const audibleBar = isBarAudible(barIndex, activeConfig.gapMode)
    const isBeatStart = subdivisionPulse === 1
    const isPrimaryAccent = beatInBar === 1 && isBeatStart
    const isCustomAccent =
      isBeatStart && activeConfig.accentBeat !== null && beatInBar === activeConfig.accentBeat

    if (audibleBar) {
      if (VOICE_SOUND_SETS.has(activeConfig.soundSet) && isBeatStart) {
        void queueVoiceCount({
          when: nextNoteTime,
          soundSet: activeConfig.soundSet,
          beatInBar,
          isPrimaryAccent,
          isCustomAccent,
        })
      } else {
        queueSynthClick({
          when: nextNoteTime,
          soundSet: VOICE_SOUND_SETS.has(activeConfig.soundSet) ? 'classic' : activeConfig.soundSet,
          isBeatStart,
          isPrimaryAccent,
          isCustomAccent,
        })
      }
    }

    queueVisualUpdate(
      {
        beatInBar,
        subdivisionPulse,
        barCount: currentBarNumber,
        audibleBar,
        currentBpm: currentBarBpm,
        elapsedSec: getElapsedAt(nextNoteTime),
      },
      nextNoteTime,
    )

    nextNoteTime += 60 / currentBarBpm / pulsesPerBeat
    currentStepInBar += 1

    if (currentStepInBar >= stepsPerBar) {
      currentStepInBar = 0
      currentBarNumber += 1
    }
  }

  function scheduler() {
    if (!audioContext || state.status !== 'running') {
      return
    }

    while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD_SEC) {
      schedulePulse()
    }

    maybeEmitElapsed()
  }

  async function ensureAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext

      if (!AudioContextClass) {
        throw new Error('当前浏览器不支持 Web Audio API。')
      }

      audioContext = new AudioContextClass()
      ensureOutputChain(audioContext)
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    applyMasterVolume(desiredConfig.masterVolume, true)
    await ensureVoiceAssets()

    return audioContext
  }

  function resetTransport() {
    currentBarNumber = 1
    currentStepInBar = 0
    currentBarBpm = desiredConfig.bpm
    nextNoteTime = 0
    activeSegmentStartedAt = 0
    accumulatedRunSec = 0
    lastUiEmitAt = 0
    pendingConfig = null
  }

  function getSnapshot() {
    const elapsedSec =
      state.status === 'running' && audioContext
        ? getElapsedAt(audioContext.currentTime)
        : state.elapsedSec

    return {
      ...state,
      config: desiredConfig,
      currentBpm:
        state.status === 'idle'
          ? desiredConfig.bpm
          : Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(state.currentBpm))),
      elapsedSec,
      isAudioReady: Boolean(audioContext),
    }
  }

  async function start(config) {
    desiredConfig = normalizeConfig(config)
    activeConfig = desiredConfig
    resetTransport()

    const context = await ensureAudioContext()

    clearScheduler()
    clearVisualTimers()
    stopScheduledVoices()
    applyMasterVolume(desiredConfig.masterVolume, true)

    activeSegmentStartedAt = context.currentTime
    nextNoteTime = context.currentTime + START_DELAY_SEC

    state = buildSnapshot(desiredConfig, {
      status: 'running',
      isAudioReady: true,
      currentBpm: desiredConfig.bpm,
    })
    notify()

    scheduler()
    schedulerTimerId = window.setInterval(scheduler, LOOKAHEAD_MS)

    return getSnapshot()
  }

  function pause() {
    if (!audioContext || state.status !== 'running') {
      return getSnapshot()
    }

    accumulatedRunSec += Math.max(0, audioContext.currentTime - activeSegmentStartedAt)
    clearScheduler()
    clearVisualTimers()
    stopScheduledVoices()

    state = {
      ...state,
      status: 'paused',
      elapsedSec: accumulatedRunSec,
    }
    notify()

    return getSnapshot()
  }

  async function resume() {
    if (state.status !== 'paused') {
      return getSnapshot()
    }

    const context = await ensureAudioContext()
    applyMasterVolume(desiredConfig.masterVolume, true)
    activeSegmentStartedAt = context.currentTime
    nextNoteTime = context.currentTime + START_DELAY_SEC

    state = {
      ...state,
      status: 'running',
      isAudioReady: true,
    }
    notify()

    scheduler()
    schedulerTimerId = window.setInterval(scheduler, LOOKAHEAD_MS)

    return getSnapshot()
  }

  function stop() {
    const finalSnapshot = getSnapshot()

    if (audioContext && state.status === 'running') {
      accumulatedRunSec += Math.max(0, audioContext.currentTime - activeSegmentStartedAt)
    }

    clearScheduler()
    clearVisualTimers()
    stopScheduledVoices()

    activeConfig = desiredConfig
    resetTransport()
    state = buildSnapshot(desiredConfig, {
      isAudioReady: Boolean(audioContext),
    })
    notify()

    return {
      ...finalSnapshot,
      elapsedSec: state.status === 'idle' ? finalSnapshot.elapsedSec : accumulatedRunSec,
    }
  }

  function updateConfig(partialConfig) {
    desiredConfig = normalizeConfig(partialConfig)

    if (audioContext) {
      applyMasterVolume(desiredConfig.masterVolume)
    }

    if (state.status === 'idle') {
      activeConfig = desiredConfig
      state = buildSnapshot(desiredConfig, {
        isAudioReady: Boolean(audioContext),
      })
      notify()
      return getSnapshot()
    }

    pendingConfig = desiredConfig
    state = {
      ...state,
      config: desiredConfig,
    }
    notify()

    return getSnapshot()
  }

  function subscribe(listener) {
    subscribers.add(listener)
    listener(getSnapshot())

    return () => {
      subscribers.delete(listener)
    }
  }

  async function dispose() {
    clearScheduler()
    clearVisualTimers()
    stopScheduledVoices()

    if (audioContext) {
      await audioContext.close()
      audioContext = null
      masterGainNode = null
      compressorNode = null
      safetyGainNode = null
    }

    state = buildSnapshot(desiredConfig)
    notify()
    subscribers.clear()
  }

  return {
    start,
    pause,
    resume,
    stop,
    updateConfig,
    subscribe,
    dispose,
  }
}
