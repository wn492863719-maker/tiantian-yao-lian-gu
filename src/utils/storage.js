import {
  DEFAULT_PRACTICE_CONFIG,
  SESSION_LIMIT,
  normalizeConfig,
} from './practice.js'

const SETTINGS_KEY = 'settings.v1'
const SESSIONS_KEY = 'sessions.v1'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function safeParse(rawValue, fallback) {
  try {
    return rawValue ? JSON.parse(rawValue) : fallback
  } catch {
    return fallback
  }
}

function normalizeSession(rawSession) {
  if (!rawSession || typeof rawSession !== 'object') {
    return null
  }

  const {
    startedAt,
    endedAt,
    durationSec,
    startBpm,
    endBpm,
    maxReachedBpm,
    configSnapshot,
  } = rawSession

  if (typeof startedAt !== 'string' || typeof endedAt !== 'string') {
    return null
  }

  return {
    startedAt,
    endedAt,
    durationSec: Math.max(0, Number(durationSec) || 0),
    startBpm: Math.max(0, Math.round(Number(startBpm) || 0)),
    endBpm: Math.max(0, Math.round(Number(endBpm) || 0)),
    maxReachedBpm: Math.max(0, Math.round(Number(maxReachedBpm) || 0)),
    configSnapshot: normalizeConfig(configSnapshot),
  }
}

export function loadSettings() {
  if (!canUseStorage()) {
    return DEFAULT_PRACTICE_CONFIG
  }

  const parsed = safeParse(window.localStorage.getItem(SETTINGS_KEY), null)
  return normalizeConfig(parsed)
}

export function hasSavedSettings() {
  if (!canUseStorage()) {
    return false
  }

  return window.localStorage.getItem(SETTINGS_KEY) !== null
}

export function saveSettings(config) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeConfig(config)))
}

export function loadSessions() {
  if (!canUseStorage()) {
    return []
  }

  const parsed = safeParse(window.localStorage.getItem(SESSIONS_KEY), [])

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed
    .map(normalizeSession)
    .filter(Boolean)
    .slice(0, SESSION_LIMIT)
}

export function saveSession(sessionRecord) {
  if (!canUseStorage()) {
    return []
  }

  const nextSessions = [normalizeSession(sessionRecord), ...loadSessions()]
    .filter(Boolean)
    .slice(0, SESSION_LIMIT)

  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(nextSessions))

  return nextSessions
}
