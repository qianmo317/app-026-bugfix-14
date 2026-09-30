import { expect, test, type Page } from '@playwright/test'
import { createScriptViaUI } from './helpers'

async function enterStageFromPrompt(page: Page) {
  await page.getByTestId('btn-stage').click()
  await page.waitForURL(/\/stage$/)
  await expect(page.getByTestId('stage-root')).toBeVisible()
}

async function unlockStage(page: Page) {
  const shield = page.getByTestId('lock-shield')
  if (await shield.count()) {
    const box = (await shield.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect(shield).toHaveCount(0, { timeout: 4000 })
    await page.mouse.up()
  }
}

async function exitStage(page: Page) {
  await unlockStage(page)
  await page.getByTestId('btn-exit').click()
  await page.waitForURL(/\/prompt\//)
}

/** 排练页 → 设置改「自动锁定」→ 浏览器后退回同一排练页（全程 SPA，wakeLock stub 不丢） */
async function setAutoLockAndBackToPrompt(page: Page, enabled: boolean) {
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.waitForURL('/settings')
  await page.getByTestId('set-lockstage').setChecked(enabled)
  await page.goBack()
  await page.waitForURL(/\/prompt\//)
}

test.describe('演出模式生命周期', () => {
  test('自动锁定跟随设置；退出时释放 Wake Lock；调速每次仅一档', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = []
      const sentinel = {
        release: async () => {
          calls.push('release')
        },
      }
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            calls.push('request')
            return sentinel
          },
        },
      })
      Object.defineProperty(window, '__wakeCalls', { value: calls })
    })

    const id = await createScriptViaUI(page, '演出生命周期', '## 第一段\n第一句\n第二句')

    await page.getByRole('link', { name: '排练' }).click()
    await page.waitForURL(`**/prompt/${id}`)

    // 勾上自动锁定 → 进演出页应锁定
    await setAutoLockAndBackToPrompt(page, true)
    await enterStageFromPrompt(page)
    await expect(page.getByTestId('lock-shield')).toBeVisible()
    await exitStage(page)

    // 取消自动锁定 → 再进演出页不应锁定
    await setAutoLockAndBackToPrompt(page, false)
    await enterStageFromPrompt(page)
    await expect(page.getByTestId('lock-shield')).toHaveCount(0)
    await expect(page.getByTestId('stage-controls')).toBeVisible()

    // 调速：按一次只变一档，演出页数字即时跟随
    const before = Number((await page.getByTestId('stage-speed-value').innerText()).replace(/px\/s/, ''))
    await page.getByTestId('btn-stage-faster').click()
    await expect(page.getByTestId('stage-speed-value')).toHaveText(`${before + 10}px/s`)
    await page.getByTestId('btn-stage-faster').click()
    await expect(page.getByTestId('stage-speed-value')).toHaveText(`${before + 20}px/s`)
    await page.getByTestId('btn-stage-slower').click()
    await expect(page.getByTestId('stage-speed-value')).toHaveText(`${before + 10}px/s`)

    // 退回排练页：速度为演出页调后的值（仅 +10），且 Wake Lock 与每次进入成对释放
    await exitStage(page)
    await expect(page.getByTestId('speed-value')).toHaveText(`${before + 10}px/s`)
    const wakeCalls = await page.evaluate(() => (window as unknown as { __wakeCalls: string[] }).__wakeCalls)
    expect(wakeCalls.filter((c) => c === 'request')).toHaveLength(2)
    expect(wakeCalls.filter((c) => c === 'release')).toHaveLength(2)
  })
})
