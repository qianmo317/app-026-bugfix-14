import { test, expect, type Page } from '@playwright/test'
import { createScriptViaUI, SAMPLE_SCRIPT } from './helpers'

/** 埋桩 navigator.wakeLock，暴露到 window.__wakeLog */
async function stubWakeLock(page: Page) {
  await page.addInitScript(() => {
    const log = { requests: 0, releases: 0, active: 0 }
    ;(window as unknown as { __wakeLog: typeof log }).__wakeLog = log
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          log.requests++
          log.active++
          return {
            release: async () => {
              log.releases++
              log.active--
            },
            addEventListener: () => {},
          }
        },
      },
    })
  })
}

const wakeLog = (page: Page) => page.evaluate(() => (window as unknown as { __wakeLog: { requests: number; releases: number; active: number } }).__wakeLog)
const savedSpeed = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('otp-settings')!) as { speedPxPerSec: number }).speedPxPerSec)

test('演出模式：锁定跟随设置，取消自动锁定后进入不再锁', async ({ page }) => {
  const id = await createScriptViaUI(page, '锁定跟随', SAMPLE_SCRIPT)

  await page.goto('/settings')
  await page.getByTestId('set-lockstage').check()
  await page.goto(`/prompt/${id}/stage`)
  await expect(page.getByTestId('stage-root')).toBeVisible()
  await expect(page.getByTestId('lock-shield')).toBeVisible()

  // 取消自动锁定后再次进入：不应上锁
  await page.goto('/settings')
  await page.getByTestId('set-lockstage').uncheck()
  await page.goto(`/prompt/${id}/stage`)
  await expect(page.getByTestId('stage-root')).toBeVisible()
  await expect(page.getByTestId('lock-shield')).toHaveCount(0)
  await expect(page.getByTestId('stage-controls')).toBeVisible()
})

test('演出模式：进入获取常亮/全屏，退出成对释放', async ({ page }) => {
  await stubWakeLock(page)
  const id = await createScriptViaUI(page, '常亮成对', SAMPLE_SCRIPT)

  await page.goto(`/prompt/${id}/stage`)
  await expect(page.getByTestId('stage-root')).toBeVisible()
  await expect.poll(() => wakeLog(page).then((l) => l.active)).toBe(1)

  // 退回排练页：哨兵必须被释放，不能常亮一整晚
  await page.getByTestId('btn-exit').click()
  await page.waitForURL(`/prompt/${id}`)
  await expect.poll(() => wakeLog(page).then((l) => l.active)).toBe(0)
  const log = await wakeLog(page)
  expect(log.releases).toBe(log.requests)
})

test('演出模式：调速按一次变一档，数字即时变化并与排练页一致', async ({ page }) => {
  const id = await createScriptViaUI(page, '调速一档', SAMPLE_SCRIPT)

  await page.goto(`/prompt/${id}/stage`)
  await expect(page.getByTestId('stage-controls')).toBeVisible()
  const base = Number((await page.getByTestId('speed-value').innerText()).replace(/px\/s/, ''))

  await page.getByTestId('btn-faster').click()
  await expect(page.getByTestId('speed-value')).toHaveText(`${base + 10}px/s`)
  await page.getByTestId('btn-faster').click()
  await expect(page.getByTestId('speed-value')).toHaveText(`${base + 20}px/s`)
  await page.getByTestId('btn-slower').click()
  await expect(page.getByTestId('speed-value')).toHaveText(`${base + 10}px/s`)
  await expect.poll(() => savedSpeed(page)).toBe(base + 10)

  // 退回排练页：速度与演出页一致，不多不少
  await page.getByTestId('btn-exit').click()
  await page.waitForURL(`/prompt/${id}`)
  await expect(page.getByTestId('speed-value')).toHaveText(`${base + 10}px/s`)
})
