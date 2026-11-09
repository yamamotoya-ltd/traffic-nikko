/* （仮）日光 渋滞ラジオ — 試作版（ステップA）
 * 話・おすすめ・話し手などの中身は data/content.json にまとめている。
 * 将来はスプレッドシート（台帳）から content.json を作る形にする。
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const state = {
    content: null,
    placeId: null,
    queue: [],          // 並べた話の順番（id の配列）
    index: -1,          // いま流している話の位置
    playing: false,
    autoContinue: false,
    mode: null,         // 'audio' | 'speech'
    chunks: [],
    chunkIndex: 0,
    volume: 1,
    done: new Set(),
  };
  const audio = new Audio();
  audio.preload = 'auto';

  /* ---------- 計測（今は記録だけ。あとでアクセス解析につなぐ） ---------- */
  function track(name, params = {}) {
    const log = JSON.parse(localStorage.getItem('trackLog') || '[]');
    log.push({ name, params, at: new Date().toISOString() });
    localStorage.setItem('trackLog', JSON.stringify(log.slice(-500)));
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  }

  /* ---------- 便利な関数 ---------- */
  const byId = (list, id) => list.find((x) => x.id === id);
  const speaker = (id) => byId(state.content.speakers, id) || { name: '', job: '' };
  const place = (id) => byId(state.content.places, id);
  const theme = (id) => byId(state.content.themes, id) || { name: '', order: 99 };
  const story = (id) => byId(state.content.stories, id);
  const rec = (id) => byId(state.content.recommendations, id);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function show(screenId) {
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== screenId; });
    window.scrollTo(0, 0);
  }

  function speakerHtml(sp) {
    const initial = esc((sp.name || '?').replace(/（.*?）/g, '').charAt(0) || '?');
    const img = sp.photo ? `<img src="${esc(sp.photo)}" alt="">` : initial;
    return `<div class="speaker"><div class="avatar">${img}</div>
      <div><div class="speaker-name">${esc(sp.name)}</div><div class="speaker-job">${esc(sp.job)}</div></div></div>`;
  }

  /* ---------- 場所 ---------- */
  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function setPlace(id) {
    state.placeId = id;
    localStorage.setItem('placeId', id);
    track('select_place', { place: id });
    buildQueue();
    renderListen();
    preloadAudio();
  }

  function startWithGeo() {
    if (!navigator.geolocation) { toast('位置情報が使えません。場所を選んでください。'); return; }
    toast('現在地を確認しています…', 8000);
    navigator.geolocation.getCurrentPosition((pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      let best = null, bestD = Infinity;
      state.content.places.forEach((p) => { const d = distanceKm(here, p); if (d < bestD) { bestD = d; best = p; } });
      if (bestD > 20) toast('日光から離れた場所のようです。いちばん近い「' + best.name + '」で始めます。', 4000);
      else toast('「' + best.name + '」の近くの話を上に並べました');
      track('geo_ok', { place: best.id });
      enterMain(best.id);
    }, () => {
      toast('位置情報が使えませんでした。場所を選んでください。', 4000);
      track('geo_ng');
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }

  function enterMain(placeId) {
    sessionStorage.setItem('started', '1');
    show('screen-main');
    setPlace(placeId);
  }

  /* ---------- 話の並べ方：テーマ順。今いる場所の話を一番上に ---------- */
  function buildQueue() {
    const list = [...state.content.stories].sort((a, b) =>
      (theme(a.theme).order - theme(b.theme).order) || ((a.order || 0) - (b.order || 0)));
    const here = list.filter((s) => (s.places || []).includes(state.placeId));
    const others = list.filter((s) => !(s.places || []).includes(state.placeId));
    // まだ聞いていない話を先に
    const sorted = [...here, ...others];
    const notDone = sorted.filter((s) => !state.done.has(s.id));
    const done = sorted.filter((s) => state.done.has(s.id));
    const currentId = state.queue[state.index];
    state.queue = [...notDone, ...done].map((s) => s.id);
    state.index = currentId ? state.queue.indexOf(currentId) : -1;
  }

  /* ---------- 画面：聞く ---------- */
  function renderListen() {
    $('#listen-places').innerHTML = state.content.places.map((p) =>
      `<button class="chip ${p.id === state.placeId ? 'active' : ''}" data-place="${esc(p.id)}">${esc(p.name)}</button>`).join('');

    $('#story-list').innerHTML = state.queue.map((id, i) => {
      const s = story(id);
      const isHere = (s.places || []).includes(state.placeId);
      const playing = i === state.index && state.playing;
      return `<li class="story ${i === state.index ? 'playing' : ''} ${state.done.has(id) ? 'done' : ''}" data-id="${esc(id)}">
        <div class="story-meta">
          ${isHere ? '<span class="tag tag-here">この近く</span>' : ''}
          <span class="tag">${esc(theme(s.theme).name)}</span>
          <span>約${esc(s.minutes || 2)}分</span>
          ${state.done.has(id) ? '<span>✓ 聞いた</span>' : ''}
        </div>
        <div class="story-title">${esc(s.title)}</div>
        ${speakerHtml(speaker(s.speakerId))}
        <div class="story-actions">
          <button class="btn btn-primary" data-play="${i}">${playing ? '♪ 再生中' : '▶ ここから聞く'}</button>
          <button class="btn btn-ghost" data-text="${esc(id)}">文章で読む</button>
        </div>
        <div class="script-text" data-script="${esc(id)}" hidden>${esc(s.script)}
          <div class="source">出典：${esc(s.source)}</div></div>
      </li>`;
    }).join('');
  }

  /* ---------- 画面：次に来るなら ---------- */
  function recCardHtml(r) {
    return `<div class="card">
      <div class="when">${esc(r.when)}</div>
      <h3>${esc(r.title)}</h3>
      <div class="place">📍 ${esc(r.place)}</div>
      <p>${esc(r.reason)}</p>
      ${speakerHtml(speaker(r.speakerId))}
      <div class="card-actions">
        <button class="btn btn-line" data-save="${esc(r.id)}">保存（LINEに届く）</button>
        <a class="btn btn-secondary" data-cal="${esc(r.id)}" href="${esc(calendarUrl(r))}" target="_blank" rel="noopener">カレンダーに入れる</a>
      </div>
    </div>`;
  }

  function renderNext() {
    $('#rec-list').innerHTML = state.content.recommendations.map(recCardHtml).join('');
  }

  function calendarUrl(r) {
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: '日光：' + r.title,
      details: `${r.when}\n${r.reason}\n\n${state.content.config.serviceName}より`,
      location: r.place,
    });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }

  function saveToLine(r) {
    track('save_rec', { rec: r.id });
    const id = state.content.config.lineOaId;
    if (!id) { toast('LINE公式アカウントは準備中です（試作版）'); return; }
    const text = '保存：' + r.place + '（' + r.title + '）';
    location.href = `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(text)}`;
  }

  /* ---------- 画面：渋滞のコツ ---------- */
  function renderTips() {
    const cfg = state.content.config;
    const live = cfg.trafficInfoUrl
      ? `<a class="btn btn-primary btn-xl" href="${esc(cfg.trafficInfoUrl)}" target="_blank" rel="noopener">最新の渋滞情報（行政のサイト）</a>` : '';
    $('#tips-list').innerHTML = live + state.content.tips.map((t) => `<div class="card">
      <h3>${esc(t.title)}</h3><p>${esc(t.body)}</p>
      ${t.links && t.links.length ? `<ul class="links">${t.links.map((l) =>
        `<li><a href="${esc(l.url)}" target="_blank" rel="noopener" data-tiplink="${esc(l.url)}">${esc(l.label)}</a></li>`).join('')}</ul>` : ''}
    </div>`).join('');
  }

  /* ---------- 再生 ---------- */
  function splitSentences(text) {
    // 読み上げが途中で止まりにくいよう、「。」ごとに区切って読む
    return text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  }

  function pickJaVoice() {
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return voices.find((v) => v.lang === 'ja-JP' && /Google|Kyoko|O-ren|Otoya/.test(v.name))
      || voices.find((v) => v.lang && v.lang.startsWith('ja'));
  }

  function playIndex(i, auto = true) {
    stopCurrent();
    if (i < 0 || i >= state.queue.length) return;
    state.index = i;
    state.autoContinue = auto;
    const s = story(state.queue[i]);
    state.playing = true;
    state.fallbackFor = null;
    track('play_story', { story: s.id });

    if (s.audio) {
      state.mode = 'audio';
      audio.src = s.audio;
      audio.volume = state.volume;
      audio.play().catch(() => fallbackToSpeech(s));
    } else {
      fallbackToSpeech(s, false);
    }
    updatePlayer();
    renderListen();
    scrollToCurrent();
  }

  function fallbackToSpeech(s, showMsg = true) {
    if (state.mode === 'speech' && state.fallbackFor === s.id) return; // 二重に読み上げない
    state.fallbackFor = s.id;
    if (!('speechSynthesis' in window)) {
      state.playing = false;
      openScript(s.id);
      toast('音声が使えないため、文章を表示しました');
      updatePlayer();
      return;
    }
    if (showMsg) toast('音声ファイルが読み込めないため、読み上げで流します');
    state.mode = 'speech';
    state.chunks = splitSentences(s.script);
    state.chunkIndex = 0;
    speakChunk();
    updatePlayer();
  }

  function speakChunk() {
    if (state.chunkIndex >= state.chunks.length) { onStoryEnd(); return; }
    const u = new SpeechSynthesisUtterance(state.chunks[state.chunkIndex]);
    u.lang = 'ja-JP';
    u.rate = 1.0;
    u.volume = state.volume;
    const v = pickJaVoice();
    if (v) u.voice = v;
    u.onend = () => {
      if (!state.playing || state.mode !== 'speech' || u._cancelled) return;
      state.chunkIndex += 1;
      speakChunk();
    };
    u.onerror = (e) => {
      if (u._cancelled || e.error === 'interrupted' || e.error === 'canceled') return;
      state.playing = false;
      openScript(story(state.queue[state.index]).id);
      toast('読み上げできなかったため、文章を表示しました');
      updatePlayer();
    };
    state.utterance = u;
    speechSynthesis.speak(u);
  }

  function stopCurrent() {
    audio.pause();
    if (window.speechSynthesis) {
      if (state.utterance) state.utterance._cancelled = true;
      speechSynthesis.cancel();
    }
  }

  function pause() {
    state.playing = false;
    if (state.mode === 'audio') audio.pause();
    else if (state.mode === 'speech') { state.utterance && (state.utterance._cancelled = true); speechSynthesis.cancel(); }
    track('pause');
    updatePlayer(); renderListen();
  }

  function resume() {
    if (state.index < 0) { playIndex(0); return; }
    state.playing = true;
    if (state.mode === 'audio') audio.play().catch(() => fallbackToSpeech(story(state.queue[state.index])));
    else speakChunk(); // 区切りの頭から読み直す
    updatePlayer(); renderListen();
  }

  function onStoryEnd() {
    const s = story(state.queue[state.index]);
    state.done.add(s.id);
    track('complete_story', { story: s.id });
    showNextPopup(s);
    const nextIdx = state.index + 1;
    if (state.autoContinue && nextIdx < state.queue.length && !state.done.has(state.queue[nextIdx])) {
      setTimeout(() => { if (state.index === nextIdx - 1) playIndex(nextIdx, true); }, 2500);
    } else {
      state.playing = false;
      updatePlayer(); renderListen();
      if ([...state.content.stories].every((x) => state.done.has(x.id))) {
        setTimeout(() => toast('全部聞き終わりました。「おわる」からアンケートへどうぞ', 4000), 1200);
      }
    }
  }

  function showNextPopup(s) {
    const r = rec(s.recommendationId);
    if (!r || $('#tab-listen').hidden) return;
    // 次の話が流れている間も見られるよう、小さめのカードで出しておく（閉じるか、次の提案が出るまで）
    $('#next-popup-body').innerHTML = `<div class="when">${esc(r.when)}</div>
      <div class="popup-title">${esc(r.title)}</div>
      <div class="card-actions row">
        <button class="btn btn-line" data-save="${esc(r.id)}">保存（LINE）</button>
        <a class="btn btn-secondary" data-cal="${esc(r.id)}" href="${esc(calendarUrl(r))}" target="_blank" rel="noopener">カレンダー</a>
      </div>`;
    $('#next-popup').hidden = false;
    track('show_rec', { rec: r.id, from: s.id });
  }

  function updatePlayer() {
    const s = state.index >= 0 ? story(state.queue[state.index]) : null;
    $('#player-title').textContent = s ? s.title : '話を選んでください';
    $('#player-mode').textContent = s ? (state.mode === 'audio' ? '音声' : '読み上げ（試作）') + '・' + speaker(s.speakerId).name : '';
    $('#btn-toggle').textContent = state.playing ? '❚❚' : '▶';
    $('#player-vol').textContent = '音量 ' + Math.round(state.volume * 100) + '%';
  }

  function changeVolume(diff) {
    state.volume = Math.min(1, Math.max(0.1, Math.round((state.volume + diff) * 10) / 10));
    audio.volume = state.volume;
    updatePlayer(); // 読み上げの音量は、次の区切り（文）から変わる
  }

  function openScript(id) {
    const el = document.querySelector(`[data-script="${CSS.escape(id)}"]`);
    if (el) el.hidden = false;
  }

  function scrollToCurrent() {
    const el = document.querySelector('.story.playing');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  audio.addEventListener('ended', () => { if (state.mode === 'audio') onStoryEnd(); });
  audio.addEventListener('error', () => {
    if (state.mode === 'audio' && state.playing) fallbackToSpeech(story(state.queue[state.index]));
  });

  /* ---------- 電波が弱くても止まらないよう、上の3本の音声を先に読み込む ---------- */
  function preloadAudio() {
    if (!('caches' in window)) return;
    const urls = state.queue.slice(0, 3).map((id) => story(id).audio).filter(Boolean);
    if (!urls.length) return;
    caches.open('nikko-audio-v1').then((c) => urls.forEach((u) =>
      c.match(u).then((hit) => hit || c.add(u).catch(() => {}))));
  }

  /* ---------- 最後の画面 ---------- */
  function renderSurvey() {
    const options = [['yes', 'はい'], ['mid', 'どちらとも'], ['no', 'いいえ']];
    document.querySelectorAll('.choice-row').forEach((row) => {
      const q = row.dataset.q;
      row.innerHTML = options.map(([v, label]) =>
        `<label><input type="radio" name="${q}" value="${v}" required><span>${label}</span></label>`).join('');
    });
    const cfg = state.content.config;
    const lineBtn = $('#btn-line-add');
    lineBtn.href = cfg.lineAddFriendUrl || '#';
    lineBtn.onclick = (e) => {
      track('line_add_click');
      if (!cfg.lineAddFriendUrl) { e.preventDefault(); toast('LINE公式アカウントは準備中です（試作版）'); }
    };
    const emailBtn = $('#btn-email');
    emailBtn.href = cfg.emailFormUrl || '#';
    emailBtn.onclick = (e) => {
      track('email_click');
      if (!cfg.emailFormUrl) { e.preventDefault(); toast('メール登録は準備中です（試作版）'); }
    };
    $('#email-consent').onchange = (e) => {
      emailBtn.classList.toggle('disabled', !e.target.checked);
      emailBtn.setAttribute('aria-disabled', String(!e.target.checked));
    };
  }

  async function submitSurvey(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answer = { q1: fd.get('q1'), q2: fd.get('q2'), q3: fd.get('q3'), listened: state.done.size, at: new Date().toISOString() };
    track('survey_submit', answer);
    const saved = JSON.parse(localStorage.getItem('surveyAnswers') || '[]');
    saved.push(answer);
    localStorage.setItem('surveyAnswers', JSON.stringify(saved));
    const url = state.content.config.surveyEndpoint;
    if (url) {
      try { await fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(answer) }); } catch (_) { /* 電波がなくても画面は進める */ }
    }
    e.target.querySelector('button[type="submit"]').hidden = true;
    $('#survey-done').hidden = false;
  }

  /* ---------- 画面の切り替え ---------- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    ['listen', 'next', 'tips'].forEach((n) => { $('#tab-' + n).hidden = n !== name; });
    $('#next-popup').hidden = true; // 提案カードは「聞く」タブでだけ出す
    track('open_tab', { tab: name });
    window.scrollTo(0, 0);
  }

  function bindEvents() {
    $('#btn-geo').onclick = startWithGeo;
    $('#welcome-places').onclick = (e) => { const b = e.target.closest('[data-place]'); if (b) enterMain(b.dataset.place); };
    $('#listen-places').onclick = (e) => { const b = e.target.closest('[data-place]'); if (b) setPlace(b.dataset.place); };

    $('#story-list').onclick = (e) => {
      const p = e.target.closest('[data-play]');
      if (p) {
        const i = Number(p.dataset.play);
        if (i === state.index && state.playing) pause(); else playIndex(i, true);
        return;
      }
      const t = e.target.closest('[data-text]');
      if (t) {
        const el = document.querySelector(`[data-script="${CSS.escape(t.dataset.text)}"]`);
        el.hidden = !el.hidden;
        if (!el.hidden) track('read_text', { story: t.dataset.text });
      }
    };

    $('#btn-play-all').onclick = () => {
      const first = state.queue.findIndex((id) => !state.done.has(id));
      playIndex(first >= 0 ? first : 0, true);
    };
    $('#btn-toggle').onclick = () => (state.playing ? pause() : resume());
    $('#btn-skip').onclick = () => {
      if (state.index + 1 < state.queue.length) playIndex(state.index + 1, true);
      else toast('最後の話です');
    };
    $('#btn-vol-up').onclick = () => changeVolume(0.1);
    $('#btn-vol-down').onclick = () => changeVolume(-0.1);
    $('#btn-popup-close').onclick = () => { $('#next-popup').hidden = true; };

    document.querySelector('.tabs').onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) switchTab(t.dataset.tab); };

    document.body.addEventListener('click', (e) => {
      const s = e.target.closest('[data-save]');
      if (s) { saveToLine(rec(s.dataset.save)); return; }
      const c = e.target.closest('[data-cal]');
      if (c) track('calendar_click', { rec: c.dataset.cal });
      const l = e.target.closest('[data-tiplink]');
      if (l) track('tip_link_click', { url: l.dataset.tiplink });
    });

    $('#btn-finish').onclick = () => { pause(); track('finish', { listened: state.done.size }); show('screen-thanks'); };
    $('#btn-back').onclick = () => show('screen-main');
    $('#survey').onsubmit = submitSurvey;
  }

  /* ---------- 起動 ---------- */
  async function init() {
    try {
      const res = await fetch('data/content.json', { cache: 'no-cache' });
      state.content = await res.json();
    } catch (err) {
      document.body.insertAdjacentHTML('beforeend', '<p class="screen">読み込みに失敗しました。電波のよい場所でもう一度開いてください。</p>');
      return;
    }
    const setSafetyH = () => document.documentElement.style.setProperty('--safety-h', document.querySelector('.safety-bar').offsetHeight + 'px');
    setSafetyH(); window.addEventListener('resize', setSafetyH);
    const name = state.content.config.serviceName;
    document.title = name;
    document.querySelectorAll('.service-name').forEach((el) => { el.textContent = name; });

    $('#welcome-places').innerHTML = state.content.places.map((p) =>
      `<button class="btn" data-place="${esc(p.id)}">${esc(p.name)}</button>`).join('');

    renderNext();
    renderTips();
    renderSurvey();
    bindEvents();
    updatePlayer();
    if (window.speechSynthesis) speechSynthesis.getVoices();

    const savedPlace = localStorage.getItem('placeId');
    if (sessionStorage.getItem('started') && savedPlace && place(savedPlace)) {
      show('screen-main'); setPlace(savedPlace);
    } else {
      show('screen-welcome');
    }
    track('open_app');

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init();
})();
