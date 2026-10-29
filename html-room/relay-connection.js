// Availability and priority only. This layer never logs room URLs or credentials.
export class RelayConnection {
  constructor(relays, { roomId, protocols, onactive, onmessage, onnotice, onfatal, ondisconnect,
    createSocket = (url, list) => new WebSocket(url, list) }) {
    Object.assign(this, { relays, roomId, protocols, onactive, onmessage, onnotice, onfatal, ondisconnect, createSocket });
    this.backoff = 1000; this.lastIndex = -1;
  }
  start() {
    this.connect(0);
    this.probeTimer = setInterval(() => {
      if (!this.stopped && this.active?.ready && this.active.index > 0 && !this.probe) this.connect(0, true);
    }, 60000);
    this.heartbeat = setInterval(() => {
      const r = this.active;
      if (!r?.ready) return;
      if (Date.now() - r.lastPong > 65000) { this.fail(r); return; }
      if (Date.now() - r.lastPing >= 25000) {
        r.lastPing = Date.now();
        try { r.ws.send(JSON.stringify({ type: 'ping' })); } catch { this.fail(r); }
      }
    }, 1000);
  }
  connect(index, probe = false) {
    if (this.stopped) return;
    const r = { index, probe, frames: [], ready: false, retired: false };
    if (probe) this.probe = r; else this.pending = r;
    try { r.ws = this.createSocket(`${this.relays[index]}/hr/${this.roomId}`, this.protocols(index)); }
    catch { this.fail(r); return; }
    r.timeout = setTimeout(() => this.fail(r), 10000);
    r.ws.onerror = () => {
      if (!r.retired && !r.probe) this.onnotice('WSS 握手失败可能是网络、Origin、鉴权或证书信任问题。正在按优先级重试；请使用有效证书，勿关闭证书校验。');
    };
    r.ws.onclose = e => this.fail(r, e.code);
    r.ws.onmessage = e => {
      if (r.retired || this.stopped || typeof e.data !== 'string' || e.data.length > 7000) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (r.ready) {
        if (this.active !== r) return;
        if (m.type === 'pong') r.lastPong = Date.now();
        this.onmessage(m); return;
      }
      if (r.frames.length >= 50) { this.fail(r); return; }
      r.frames.push(m);
      if (m.type === 'hello' && !r.activating && Number.isInteger(m.you) && m.you >= 1 && m.you <= 25
        && typeof m.resume === 'string' && /^[0-9a-f]{32}$/.test(m.resume)) {
        r.activating = true; this.activate(r).catch(() => this.fail(r));
      }
    };
  }
  async activate(r) {
    const old = this.active;
    const changed = this.lastIndex !== -1 && this.lastIndex !== r.index;
    this.active = r;
    if (this.probe === r) this.probe = null;
    if (this.pending === r) this.pending = null;
    if (old && old !== r) this.retire(old);
    await this.onactive(r.ws, r.index, changed);
    if (r.retired || this.stopped || this.active !== r) return;
    clearTimeout(r.timeout);
    this.lastIndex = r.index; this.backoff = 1000;
    r.ready = true; r.lastPong = r.lastPing = Date.now();
    for (const m of r.frames) this.onmessage(m);
    r.frames = [];
  }
  retire(r) {
    if (!r || r.retired) return;
    r.retired = true; clearTimeout(r.timeout);
    try { r.ws?.close(4000); } catch { /* Already closed or handshake still pending. */ }
  }
  fail(r, code) {
    if (r.retired || this.stopped) return;
    this.retire(r);
    if (this.probe === r) { this.probe = null; return; }
    if (this.pending === r) this.pending = null;
    if (this.active === r) { this.active = null; this.ondisconnect(); }
    if (this.relays.length === 1 && [4000,4001,4002,4005,4006,4007,4008,1008,1009].includes(code)) {
      this.stop(); this.onfatal(); return;
    }
    // An in-flight probe must not compete with the next ordered retry.
    this.retire(this.probe); this.probe = null;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect((r.index + 1) % this.relays.length), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
    if (code !== 1006) this.onnotice('连接中断，正在按列表顺序切换中继；不同中继上的成员暂时无法互通。');
  }
  stop() {
    this.stopped = true; clearTimeout(this.retry); clearInterval(this.probeTimer); clearInterval(this.heartbeat);
    this.retire(this.active); this.retire(this.pending); this.retire(this.probe);
  }
}
