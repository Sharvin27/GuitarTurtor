// YTSync: a small floating YouTube player (like Songsterr's video panel) whose playback time drives the page.
// Classic script (not a module) so both the tab view and the 3D view can use window.YTSync.
(function () {
  const API = 'https://www.youtube.com/iframe_api';
  let apiPromise = null;
  function loadApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement('script');
      s.src = API; s.async = true;
      s.onerror = () => { apiPromise = null; reject(new Error('YouTube could not be reached')); };
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('YouTube took too long to load')), 15000);
    });
    return apiPromise;
  }

  const CSS = `
  .ytpanel { position: fixed; right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(var(--ytpanel-bottom, 96px) + env(safe-area-inset-bottom, 0px));
    z-index: 30; width: 216px; border-radius: 12px; overflow: hidden; background: #0e0f12; border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 10px 30px rgba(0,0,0,.45); font: 600 13px/1.2 system-ui, sans-serif; color: #e9ebef; }
  .ytpanel .ythead { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; background: #181b21; }
  .ytpanel .ythead span { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ytpanel .ythead button { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; color: #c9ced8; }
  .ytpanel .ythead button:hover { background: rgba(255,255,255,.1); }
  .ytpanel .ythead button:focus-visible { outline: 2px solid #3d8bfd; }
  .ytpanel .ytbody { aspect-ratio: 9 / 16; max-height: 46vh; width: 100%; background: #000; }
  .ytpanel .ytbody iframe, .ytpanel .ytbody > div { width: 100%; height: 100%; display: block; border: 0; }
  .ytpanel.min .ytbody { height: 0; aspect-ratio: auto; }
  @media (max-width: 600px) { .ytpanel { width: 132px; } .ytpanel .ythead span { display: none; } }`;

  class YTSync {
    constructor({ onState, onError } = {}) {
      this.onState = onState; this.onError = onError;
      this.player = null; this.ready = false; this.state = -1; this.rate = 1;
      this._anchor = 0; this._perf = 0; this._raw = -1;
      if (!document.getElementById('ytsync-css')) {
        const st = document.createElement('style'); st.id = 'ytsync-css'; st.textContent = CSS; document.head.appendChild(st);
      }
      const p = document.createElement('div');
      p.className = 'ytpanel'; p.hidden = true;
      p.innerHTML = '<div class="ythead"><span>Original video</span><button type="button" aria-label="Minimise video" title="Minimise">–</button></div><div class="ytbody"><div></div></div>';
      document.body.appendChild(p);
      this.panel = p; this.mount = p.querySelector('.ytbody > div');
      const btn = p.querySelector('button');
      btn.addEventListener('click', () => {
        const min = p.classList.toggle('min');
        btn.textContent = min ? '▢' : '–';
        btn.setAttribute('aria-label', min ? 'Show video' : 'Minimise video');
      });
    }
    async load(videoId, title) {
      this.ready = false;
      this.panel.querySelector('.ythead span').textContent = title || 'Original video';
      await loadApi();
      if (this.player && this.player.cueVideoById) {
        this.player.cueVideoById(videoId);
        this.ready = true; this.panel.hidden = false; return;
      }
      await new Promise((resolve, reject) => {
        this.player = new YT.Player(this.mount, {
          videoId, width: 216, height: 384,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
          events: {
            onReady: () => { this.ready = true; this.panel.hidden = false; resolve(); },
            onStateChange: e => { this.state = e.data; this._resync(); if (this.onState) this.onState(e.data); },
            onError: e => { this.ready = false; this.panel.hidden = true; if (this.onError) this.onError(e.data); reject(new Error('YouTube error ' + e.data)); },
          },
        });
        this.mount = this.panel.querySelector('.ytbody iframe') || this.mount;
      });
    }
    _resync(t) {
      const raw = t != null ? t : (this.player && this.player.getCurrentTime ? this.player.getCurrentTime() : 0);
      this._anchor = raw; this._raw = raw; this._perf = performance.now();
    }
    play(t, rate) {
      if (!this.ready) return;
      this.setRate(rate);
      this.player.seekTo(t, true); this._resync(t);
      this.player.playVideo();
    }
    pause() { if (this.ready) this.player.pauseVideo(); this._resync(); }
    seek(t) { if (this.ready) { this.player.seekTo(t, true); this._resync(t); } }
    setRate(r) {
      this.rate = r || 1;
      if (!this.ready) return;
      this.player.setPlaybackRate(this.rate);       // YouTube snaps to its own steps (0.25, 0.5, 0.75, 1, 1.25 …)
      const got = this.player.getPlaybackRate && this.player.getPlaybackRate();
      if (got) this.rate = got;
    }
    // getCurrentTime() only updates a few times a second; interpolate between updates for a smooth cursor
    time() {
      if (!this.ready) return 0;
      const raw = this.player.getCurrentTime(), now = performance.now();
      if (this.state !== 1) { this._resync(raw); return raw; }
      const est = this._anchor + (now - this._perf) / 1000 * this.rate;
      if (Math.abs(raw - this._raw) > 1e-3 || Math.abs(est - raw) > 0.3) { this._anchor = raw; this._raw = raw; this._perf = now; return raw; }
      return est;
    }
    get playing() { return this.state === 1 || this.state === 3; }
    hide() { this.panel.hidden = true; }
  }
  window.YTSync = YTSync;
})();
