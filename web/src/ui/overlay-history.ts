const marker = 'wp:overlay'
type Entry = { id: number; close: () => void }
export class OverlayHistory {
  private entries: Entry[] = []
  private sequence = 0
  private discarded = new Set<number>()
  private routeIndex = 0
  private overlayPosition = 0
  private onPop = (event: PopStateEvent) => {
    const id = this.win.history.state?.[marker]
    if (this.discarded.has(id)) {
      // 跳转后遗留的弹层记录不应成为可停留的路由。
      event.stopImmediatePropagation()
      const index = this.win.history.state?.idx ?? 0
      const backward =
        index < this.routeIndex ||
        (index === this.routeIndex && id < this.overlayPosition)
      this.routeIndex = index
      this.overlayPosition = id
      this.win.history.go(backward ? -1 : 1)
      return
    }
    this.routeIndex = this.win.history.state?.idx ?? 0
    this.overlayPosition = id ?? 0
    const index = this.entries.findIndex((e) => e.id === id)
    const removed = this.entries.splice(index + 1)
    for (const entry of removed.reverse()) {
      this.discarded.add(entry.id)
      entry.close()
    }
  }
  constructor(private win: Window) {
    this.routeIndex = win.history.state?.idx ?? 0
    win.addEventListener('popstate', this.onPop, true)
  }
  open(close: () => void) {
    const id = ++this.sequence
    this.entries.push({ id, close })
    this.win.history.pushState({ ...this.win.history.state, [marker]: id }, '')
    this.overlayPosition = id
    return id
  }
  close(id: number) {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index < 0) return
    const removed = this.entries.splice(index)
    const top = removed.at(-1)!
    for (const entry of removed.reverse()) {
      this.discarded.add(entry.id)
      entry.close()
    }
    // 等当前事件及微任务中的路由跳转完成，再确认是否仍需消费记录。
    // 否则清会话导致弹层卸载时，异步返回可能覆盖紧随其后的登录跳转。
    this.win.setTimeout(() => {
      if (this.win.history.state?.[marker] === top.id)
        this.win.history.go(-removed.length)
    }, 0)
  }
  clearForRoute() {
    const entries = this.entries.splice(0)
    for (const entry of entries.reverse()) {
      this.discarded.add(entry.id)
      entry.close()
    }
    const state = { ...this.win.history.state }
    delete state[marker]
    this.win.history.replaceState(state, '')
    this.routeIndex = state.idx ?? 0
    this.overlayPosition = 0
  }
  dispose() {
    this.win.removeEventListener('popstate', this.onPop, true)
  }
}
export const overlayHistory =
  typeof window === 'undefined' ? null : new OverlayHistory(window)
