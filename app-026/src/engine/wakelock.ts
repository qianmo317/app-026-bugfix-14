export interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener?: (type: string, fn: () => void) => void
}

type WakeLockNav = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

/**
 * 屏幕常亮守卫：获取/释放严格配对，防止 Wake Lock 泄漏耗电。
 * 不支持（或非 HTTPS/localhost）时 acquire 返回 false，由 UI 提示手动设置。
 *
 * 用代际计数（gen）处理「请求尚未 resolve 就被 release」的交错时序：
 * 过期代际 resolve 出的 sentinel 立即补释放并丢弃，绝不挂到当前守卫上，
 * 保证任何 acquire/release 交错下既不泄漏也不重复持有。
 */
export class WakeLockGuard {
  private sentinel: WakeLockSentinelLike | null = null
  private gen = 0

  supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator
  }

  async acquire(): Promise<boolean> {
    if (this.sentinel) return true
    const nav = navigator as WakeLockNav | undefined
    if (!nav || !nav.wakeLock) return false
    const gen = this.gen
    let sentinel: WakeLockSentinelLike
    try {
      sentinel = await nav.wakeLock.request('screen')
    } catch {
      return false
    }
    // 请求期间发生过 release（或 acquire 已被新一代覆盖）：这枚哨兵已不属于当前守卫，立即补释放
    if (gen !== this.gen) {
      try {
        await sentinel.release()
      } catch {
        /* 已释放则忽略 */
      }
      return this.sentinel != null
    }
    this.sentinel = sentinel
    return true
  }

  async release(): Promise<void> {
    this.gen++
    const s = this.sentinel
    this.sentinel = null
    if (s) {
      try {
        await s.release()
      } catch {
        /* 已释放则忽略 */
      }
    }
  }

  get active() {
    return this.sentinel != null
  }
}
