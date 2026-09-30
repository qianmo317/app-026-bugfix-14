import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Root } from 'react-dom/client'
import * as repo from '../../src/storage/repo'
import type { PromptSettings, Script } from '../../src/types'
import App from '../../src/App'
import { navigate } from '../../src/router'

/**
 * 演出模式回归测试（真实组件挂载，含 StrictMode 双挂载）：
 * 1. 自动锁定只在「进入」时跟随设置，取消后再进不再锁
 * 2. Wake Lock / 全屏进入与退出成对，不泄漏
 * 3. 调速按一次变一档，屏上数字即时更新且与排练页/设置一致
 */

const SETTINGS: PromptSettings = {
  fontSizePx: 48,
  autoFit: true,
  autoScroll: false,
  speedPxPerSec: 90,
  theme: 'dark',
  holdOnCue: true,
  lockStage: false,
}

const SCRIPT: Script = {
  id: 's1',
  title: '测试剧',
  style: 'opera',
  updatedAt: 1,
  lines: [
    { id: 'l1', role: '生', text: '杨延辉坐宫院', cues: [], marks: [] },
    { id: 'l2', role: '旦', text: '自思自叹', cues: [], marks: [] },
  ],
  segments: [{ id: 'seg1', title: '第一段', lineIds: ['l1', 'l2'] }],
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const rafSettle = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  })

let container: HTMLDivElement
let root: Root

async function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  root = createRoot(container)
  await act(async () => {
    root.render(<App />)
    await tick()
    await tick()
  })
  await rafSettle()
}

async function unmount() {
  await act(async () => {
    root.unmount()
    await tick()
  })
}

let wakeLog = { requests: 0, releases: 0 }
let fsEnter = 0
let fsExit = 0

function stubEnv() {
  wakeLog = { requests: 0, releases: 0 }
  fsEnter = 0
  fsExit = 0
  let fsEl: Element | null = null
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })

  Object.defineProperty(globalThis.navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        wakeLog.requests++
        return {
          release: async () => {
            wakeLog.releases++
          },
          addEventListener: () => {},
        }
      },
    },
  })

  HTMLElement.prototype.requestFullscreen = vi.fn(function (this: HTMLElement) {
    fsEnter++
    fsEl = this
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl })
    return Promise.resolve()
  }) as typeof HTMLElement.prototype.requestFullscreen
  document.exitFullscreen = vi.fn(async () => {
    fsExit++
    fsEl = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
  })
}

beforeEach(async () => {
  localStorage.clear()
  stubEnv()
  await repo.saveScript(SCRIPT)
  await repo.saveSettings(SETTINGS)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await unmount()
  container.remove()
})

const $ = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)
const speedText = () => ($('speed-value')?.textContent ?? '').trim()

describe('演出模式 · 锁定跟随设置', () => {
  it('勾选自动锁定进入即锁；取消后再进入不锁', async () => {
    await repo.saveSettings({ ...SETTINGS, lockStage: true })
    await renderAt('/prompt/s1/stage')
    expect($('lock-shield')).not.toBeNull()
    expect($('stage-controls')).toBeNull()

    // 退出到设置页，取消自动锁定
    await act(async () => navigate('/settings'))
    const checkbox = $('set-lockstage') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    await act(async () => {
      checkbox.click()
      await tick()
    })

    // 再次进入演出模式：不应锁定
    await act(async () => {
      navigate('/prompt/s1/stage')
      await tick()
    })
    await rafSettle()
    expect($('lock-shield')).toBeNull()
    expect($('stage-controls')).not.toBeNull()
  })
})

describe('演出模式 · 常亮与全屏成对', () => {
  it('进入获取、退出释放（StrictMode 双挂载后仍恰好 1:1）', async () => {
    await renderAt('/prompt/s1/stage')
    await act(async () => {
      await tick()
    })
    expect(fsEnter).toBe(1)
    expect(wakeLog.requests).toBe(1)

    // 退回排练页（真实卸载 Stage）
    await act(async () => {
      ;($('btn-exit') as HTMLElement).click()
      await tick()
    })
    await rafSettle()
    expect(wakeLog.releases).toBe(wakeLog.requests)
    expect(fsExit).toBe(1)
  })
})

describe('演出模式 · 调速按一次变一档', () => {
  it('加速/减速每按一次只变一档，数字即时更新并同步设置', async () => {
    await renderAt('/prompt/s1/stage')
    expect(speedText()).toBe('90px/s')

    await act(async () => {
      ;($('btn-faster') as HTMLElement).click()
    })
    expect(speedText()).toBe('100px/s')

    await act(async () => {
      ;($('btn-faster') as HTMLElement).click()
    })
    expect(speedText()).toBe('110px/s')

    await act(async () => {
      ;($('btn-slower') as HTMLElement).click()
    })
    expect(speedText()).toBe('100px/s')

    // 设置已同步为 100（旧实现此处会多写一档）
    const saved = await repo.loadSettings()
    expect(saved.speedPxPerSec).toBe(100)

    // 退回排练页：速度一致，不多不少
    await act(async () => {
      ;($('btn-exit') as HTMLElement).click()
      await tick()
    })
    await rafSettle()
    expect(speedText()).toBe('100px/s')
  })
})
