import 'fake-indexeddb/auto'

// React 18 在 jsdom 下需要显式标记，否则 act() 会刷警告
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
