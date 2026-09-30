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
 */
export class WakeLockGuard {
  private sentinel: WakeLockSentinelLike | null = null
  private requestSeq = 0

  supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator
  }

  async acquire(): Promise<boolean> {
    if (this.sentinel) return true
    const nav = navigator as WakeLockNav | undefined
    if (!nav || !nav.wakeLock) return false
    const seq = ++this.requestSeq
    try {
      const sentinel = await nav.wakeLock.request('screen')
      // React StrictMode 或快速退页时，请求可能在 release() 之后才返回。
      // 这个 sentinel 不能再保存，否则会形成永远释放不掉的常亮锁。
      if (seq !== this.requestSeq) {
        try {
          await sentinel.release()
        } catch {
          /* 已释放则忽略 */
        }
        return false
      }
      this.sentinel = sentinel
      return true
    } catch {
      return false
    }
  }

  async release(): Promise<void> {
    this.requestSeq++
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
