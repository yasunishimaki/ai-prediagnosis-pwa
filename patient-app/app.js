// ============================================
// AI事前問診メモ - デモ版（7月2日 クレアスクリニック）
// 自由発話 → AIが不足項目を音声で追加質問 → メモ確定 → QR表示
//
// 【配布用バックエンド】
// このアプリと同じドメインの /api/*（Cloudflare Pages Functions: functions/api/*.js）が
// OpenAI へ中継する。APIキーは Pages の環境変数(Secret)に保存し、クライアントには置かない。
// 同一オリジン（同じドメイン）で呼ぶため CORS は不要。
// ============================================

// ====== バックエンド（同一ドメインの Pages Functions）======
// 配信元と同じオリジンを使う。独自ドメインを後付けしてもそのまま動く。
const API_PROXY_BASE = window.location.origin;
// Pages 側で APP_TOKEN を設定した場合のみ、同じ合言葉を入れる（任意）
const API_APP_TOKEN = '';
// ===========================================

// バックエンド経由 or 端末のAPIキーが使える場合は本番動作（それ以外はモック）
function isLiveMode() {
  return !!API_PROXY_BASE || !!state.apiKey;
}

// API呼び出し先・ヘッダーの共通化（プロキシ or 直接OpenAI）
function apiEndpoint(path) {
  if (API_PROXY_BASE) {
    const map = { 'audio/transcriptions': '/api/transcribe', 'chat/completions': '/api/chat' };
    return API_PROXY_BASE.replace(/\/+$/, '') + (map[path] || ('/' + path));
  }
  return 'https://api.openai.com/v1/' + path;
}

function apiHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (API_PROXY_BASE) {
    if (API_APP_TOKEN) h['x-app-token'] = API_APP_TOKEN; // 合言葉（設定時のみ）
  } else {
    h['Authorization'] = `Bearer ${state.apiKey}`;        // 直接呼び出し時のみキーを付与
  }
  return h;
}

// ---------- 状態管理 ----------
const state = {
  apiKey: null,
  template: null,          // 現在のクリニックテンプレート
  activeItems: [],         // 今回の問診で確認する項目（コア＋主訴別）
  memoData: {},            // key -> 値（"不明"含む）
  queue: [],               // これから質問する不足項目
  currentItem: null,       // 質問中の項目
  attemptCount: 0,         // 現項目への追加質問回数
  fullTranscript: '',      // 最初の自由発話の全文

  mediaRecorder: null,
  audioChunks: [],
  audioBlob: null,
  recordingStartTime: null,
  recordingTimerId: null,
  isRecording: false,
  recordingHandler: null,  // 録音停止時に呼ぶ関数（初回 or 回答）

  currentMemo: null,
  editingItemKey: null,
  _mockPattern: null,
};

const MAX_FOLLOWUP_ATTEMPTS = 2; // 1項目につき最大2回まで聞き直す

// ---------- モックデータ（APIキー未設定時） ----------
// わざと一部の項目を欠落させ、追加質問フローを体験できるようにしている
const MOCK_PATTERNS = [
  {
    transcript: '昨日の夜寝る前くらいから、頭がズキズキ痛むんです。吐き気もあります。降圧薬は毎日飲んでます。',
    filled: {
      chiefComplaint: '後頭部のズキズキする頭痛',
      onset: '昨日の夜、寝る前ごろから',
      quality: '後頭部が拍動するようにズキズキ痛む。吐き気を伴う',
      medication: '降圧薬を毎日服用',
      // allergy / history / fever / travel / family は未回答 → 追加質問
    },
    mockAnswers: {
      allergy: '特にありません',
      history: '高血圧で近所の病院に通っています',
      fever: '熱はないと思います',
      travel: '行っていません',
      family: '家族は元気です',
      pain_onset: '急にではなく、だんだん痛くなりました',
      pain_provoke: '体を動かすと少しひびきます',
      pain_quality: 'ズキズキする感じです',
      pain_region: '後頭部です。首のあたりにも少し',
      pain_severity: '10段階だと6くらい',
      pain_timing: 'ずっと続いていて、夜に強くなります',
    },
  },
  {
    transcript: '3日前に重い荷物を持ち上げてから、腰が痛くて。動くと痛みます。お薬は飲んでいません。',
    filled: {
      chiefComplaint: '腰の痛み',
      onset: '3日前、重い荷物を持ち上げたとき',
      quality: '腰が鈍く痛む。体を動かすと強くなる',
      medication: '内服薬はなし（湿布を使用中）',
    },
    mockAnswers: {
      allergy: 'アレルギーはありません',
      history: '特に持病はありません',
      fever: '熱はありません',
      travel: '海外には行っていません',
      family: '家族は大丈夫です',
      pain_onset: '荷物を持った時に急に痛めました',
      pain_provoke: '前かがみになると痛いです。横になると楽です',
      pain_quality: '鈍い痛みです',
      pain_region: '腰の真ん中あたりです',
      pain_severity: '7くらいです',
      pain_timing: '動かなければ大丈夫ですが、動くと痛みます',
    },
  },
];

// ---------- 初期化 ----------
window.addEventListener('DOMContentLoaded', () => {
  state.template = CLINIC_TEMPLATES[ACTIVE_CLINIC_ID];
  loadApiKey();
  applyClinicBranding();
  updateModeBadge();
  refreshStartScreen();   // 下書き・直近メモに応じてスタート画面のボタンを出し分け
  registerServiceWorker();
});

function applyClinicBranding() {
  const t = state.template;
  document.querySelectorAll('.clinic-name').forEach(el => { el.textContent = t.clinicName; });
  setText('clinic-dept', t.department);
  setText('opening-prompt', t.openingPrompt);
}

// アクティブな画面内の要素を取得（mic等は画面ごとに重複するためクラスで絞る）
function activeEl(selector) {
  const screen = document.querySelector('.screen.active');
  return screen ? screen.querySelector(selector) : null;
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.log('Service Worker登録失敗:', err);
    });
  }
}

// ---------- 画面切替 ----------
function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('screen-' + screenName);
  if (target) target.classList.add('active');
  if (screenName === 'start') refreshStartScreen();
  if (screenName === 'history') renderHistory();
  if (screenName === 'settings') {
    document.getElementById('apikey-input').value = state.apiKey || '';
  }
}

// ---------- APIキー管理 ----------
function loadApiKey() {
  state.apiKey = localStorage.getItem('openai_api_key') || null;
}

function saveApiKey() {
  const input = document.getElementById('apikey-input').value.trim();
  if (input) {
    localStorage.setItem('openai_api_key', input);
    state.apiKey = input;
    showToast('APIキーを保存しました');
  } else {
    showToast('APIキーを入力してください');
  }
  updateModeBadge();
}

function clearApiKey() {
  localStorage.removeItem('openai_api_key');
  state.apiKey = null;
  document.getElementById('apikey-input').value = '';
  showToast('APIキーを削除しました');
  updateModeBadge();
}

function updateModeBadge() {
  const badge = document.getElementById('mode-badge');
  const modeText = document.getElementById('current-mode');
  if (API_PROXY_BASE) {
    // バックエンド経由（キーはサーバー側／配布可能）
    if (badge) { badge.textContent = '本番API（サーバー）'; badge.className = 'mode-badge api'; }
    if (modeText) modeText.textContent = '🟢 本番API（サーバー経由）';
  } else if (state.apiKey) {
    if (badge) { badge.textContent = '本番API'; badge.className = 'mode-badge api'; }
    if (modeText) modeText.textContent = '🟢 OpenAI API（端末キー）';
  } else {
    if (badge) { badge.textContent = 'モック'; badge.className = 'mode-badge mock'; }
    if (modeText) modeText.textContent = '🟡 モック動作';
  }
}

// ============================================
// 問診フロー
// ============================================

// ---------- ① 問診開始（自由発話） ----------
function startInterview() {
  // 入力中の下書きがあれば、新規開始で消える旨を確認（再開はresumeInterviewで別途行う）
  if (loadDraft()) {
    if (!confirm('入力中の問診メモがあります。\n新しく始めると、その内容は消えます。よろしいですか？')) return;
  }
  clearDraft();
  state.activeItems = [];
  state.memoData = {};
  state.queue = [];
  state.currentItem = null;
  state.fullTranscript = '';
  state._mockPattern = null;
  // 前の患者のデータを絶対に持ち越さない（同一端末を使い回しても混ざらないように完全クリア）
  state.currentMemo = null;
  state.initialSummary = '';
  state.editingItemKey = null;
  state.recordingHandler = handleInitialAudio;
  showScreen('recording');
  resetRecording();
}

// ---------- ② 録音まわり（汎用） ----------
function resetRecording() {
  state.isRecording = false;
  state.audioChunks = [];
  state.audioBlob = null;
  const mic = activeEl('.mic-button');
  if (mic) { mic.classList.remove('recording'); mic.innerHTML = '🎤'; }
  const timer = activeEl('.recording-timer');
  if (timer) timer.style.display = 'none';
  const wave = activeEl('.wave-bars');
  if (wave) wave.style.display = 'none';
}

async function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    await beginRecording();
  }
}

async function beginRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    }

    state.mediaRecorder = new MediaRecorder(stream, { mimeType });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.onstop = () => {
      state.audioBlob = new Blob(state.audioChunks, { type: mimeType });
      stream.getTracks().forEach(track => track.stop());
      if (typeof state.recordingHandler === 'function') {
        state.recordingHandler(state.audioBlob);
      }
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    state.recordingStartTime = Date.now();

    const mic = activeEl('.mic-button');
    if (mic) { mic.classList.add('recording'); mic.innerHTML = '⏸'; }
    const timer = activeEl('.recording-timer');
    if (timer) timer.style.display = 'block';
    const wave = activeEl('.wave-bars');
    if (wave) wave.style.display = 'flex';

    state.recordingTimerId = setInterval(updateTimer, 100);
  } catch (err) {
    console.error('録音開始エラー:', err);
    if (err.name === 'NotAllowedError') {
      alert('マイクへのアクセスが許可されていません。\nブラウザの設定でマイクを許可してください。');
    } else {
      alert('録音を開始できませんでした: ' + err.message);
    }
    showScreen('start');
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    clearInterval(state.recordingTimerId);
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  const timer = activeEl('.recording-timer');
  if (timer) timer.textContent = `${m}:${s}`;
}

// ---------- ③ 最初の発話を処理 ----------
async function handleInitialAudio(audioBlob) {
  showScreen('loading');
  setLoadingText('お話を聞き取っています', '音声を文字に変換中...');
  try {
    const transcript = await transcribeAudio(audioBlob);
    if (!transcript || !transcript.trim()) {
      // 音声が拾えなかった（無音/幻聴を弾いた）→ メモを作らず録音し直してもらう
      showScreen('recording');
      resetRecording();
      showToast('うまく聞き取れませんでした。もう一度、はっきりお話しください');
      return;
    }
    state.fullTranscript = transcript;
    state.initialSummary = transcript; // フォールバック：要約に失敗しても発話そのものを残す

    // 主訴別グループの判定（最初の発話にキーワードが含まれるか）
    buildActiveItems(transcript);

    setLoadingText('内容を整理しています', '不足している項目を確認中...');
    // 要約（メモ冒頭用）と「項目抽出＋深掘り立案」を並列実行。
    // 抽出と質問作成を1回のAI判断にまとめることで、既に話したことを聞き返さない。
    const [summary, plan] = await Promise.all([
      summarizeInitial(transcript),
      analyzeAndPlan(transcript, state.activeItems),
    ]);
    if (summary && summary.trim()) state.initialSummary = summary.trim();

    // 抽出結果を memoData に反映し、埋まらなかった基本項目だけ queue に積む
    const filled = plan.filled || {};
    state.queue = [];
    state.activeItems.forEach(item => {
      const v = filled[item.key];
      if (v && String(v).trim() && !isUnknown(v)) {
        state.memoData[item.key] = String(v).trim();
      } else {
        state.queue.push(item);
      }
    });

    // 深掘り質問（実APIモードのみ）。既に話した内容は analyzeAndPlan が除外済みなので、
    // そのまま質問キューに積んでよい（聞き返しは起きない）。
    if (isLiveMode() && Array.isArray(plan.questions) && plan.questions.length) {
      const extra = plan.questions
        .filter(q => q && q.question && String(q.question).trim())
        .slice(0, 3)
        .map((q, i) => ({
          key: 'dx_' + (i + 1),
          label: (q.label && String(q.label).trim()) || `補足${i + 1}`,
          question: String(q.question).trim(),
        }));
      if (extra.length) {
        state.activeItems = state.activeItems.concat(extra);
        state.queue = extra.concat(state.queue); // 主訴に沿った質問を先に聞く
      }
    }

    saveDraft();   // 初回分析の結果を保存（ここで中断しても続きから再開できる）
    startFollowup();
  } catch (err) {
    console.error('処理エラー:', err);
    alert('処理中にエラーが発生しました:\n' + err.message);
    showScreen('start');
  }
}

function buildActiveItems(transcript) {
  const t = state.template;
  // コア項目は主訴に関わらず必ず確認する基本セット
  const items = [...t.coreItems];
  // モック（実API未使用）時のみ、キーワードで主訴別テンプレを追加する。
  // 実APIモードでは、患者の話に合わせてAIが深掘り質問を動的生成する（analyzeAndPlan）。
  if (!isLiveMode()) {
    t.conditionalGroups.forEach(group => {
      if (group.match.some(kw => transcript.includes(kw))) {
        group.items.forEach(it => items.push(it));
      }
    });
  }
  state.activeItems = items;
}

// ---------- ④ 不足項目を1つずつ追加質問 ----------
function startFollowup() {
  updateProgress();
  if (state.queue.length === 0) {
    finishInterview();
    return;
  }
  askNextItem();
}

function askNextItem() {
  state.currentItem = state.queue.shift();
  state.attemptCount = 0;
  state.currentItemAnswers = [];   // この項目への回答を蓄積（再質問の答えを合わせて解釈）
  state.recordingHandler = handleFollowupAudio;
  saveDraft();   // 直前の回答までの進捗＋現在の質問を保存（中断時はこの質問から再開）
  renderFollowupQuestion(state.currentItem.question, false);
  showScreen('followup');
  resetRecording();
  updateProgress();
}

function renderFollowupQuestion(question, isReprompt) {
  setText('followup-label', state.currentItem.label);
  setText('followup-question', question);
  // 聞き直しのときは、エラーや二重質問に見えないよう目立つ案内バーを出す
  const banner = document.getElementById('followup-reprompt');
  if (banner) banner.style.display = isReprompt ? 'block' : 'none';
  const card = document.getElementById('followup-card');
  if (card) card.classList.toggle('reprompt', !!isReprompt);
  const hint = document.getElementById('followup-hint');
  if (hint) {
    hint.textContent = isReprompt
      ? 'もう少し具体的に教えてください。わからない場合は「わかりません」とお話しください。'
      : 'マイクを押して、お答えください。';
  }
}

function updateProgress() {
  const total = state.activeItems.length;
  const answered = state.activeItems.filter(it => state.memoData[it.key]).length;
  const bar = document.getElementById('progress-fill');
  const txt = document.getElementById('progress-text');
  if (bar) bar.style.width = total ? `${Math.round((answered / total) * 100)}%` : '0%';
  if (txt) txt.textContent = `${answered} / ${total} 項目`;
}

async function handleFollowupAudio(audioBlob) {
  showScreen('followup-loading');
  try {
    const answer = await transcribeAudio(audioBlob, state.currentItem);
    // 同じ項目への回答を蓄積し、再質問の答えを最初の答えと「合わせて」解釈する
    if (!Array.isArray(state.currentItemAnswers)) state.currentItemAnswers = [];
    if (answer && String(answer).trim()) state.currentItemAnswers.push(String(answer).trim());
    const combined = state.currentItemAnswers.join('。');

    // 何も聞き取れなかった（無音/幻聴を弾いた）→ 即座に聞き直す（評価APIは呼ばない）
    if ((!answer || !String(answer).trim()) && !combined) {
      state.attemptCount++;
      if (state.attemptCount < MAX_FOLLOWUP_ATTEMPTS) {
        state.recordingHandler = handleFollowupAudio;
        renderFollowupQuestion(state.currentItem.question, true);
        showScreen('followup');
        resetRecording();
      } else {
        state.memoData[state.currentItem.key] = bestPatientAnswer(state.currentItemAnswers);
        askOrFinish();
      }
      return;
    }

    // 「わからない／測っていない」等と明言したら、聞き直さず「不明」で確定して次へ進む。
    // ただし、それ以前に具体的な回答があれば握りつぶさず通常の評価に回す。
    if (answer && isClearUnknown(answer) &&
        !state.currentItemAnswers.some(a => !isClearUnknown(a))) {
      state.memoData[state.currentItem.key] = '不明';
      askOrFinish();
      return;
    }

    const value = await evaluateAnswer(state.currentItem, combined);

    if (value && !isUnknown(value)) {
      state.memoData[state.currentItem.key] = String(value).trim();
      askOrFinish();
    } else {
      state.attemptCount++;
      if (state.attemptCount < MAX_FOLLOWUP_ATTEMPTS) {
        // もう1回だけ聞き直す。汎用文だと「何を聞かれているか」が分からず別の話題を答えて
        // しまい、その答えが現在の項目に誤って保存される。項目の質問文を再表示して話題を保つ。
        state.recordingHandler = handleFollowupAudio;
        renderFollowupQuestion(state.currentItem.question, true);
        showScreen('followup');
        resetRecording();
      } else {
        // 抽出できなくても、患者が具体的に話していればその内容を残す（不明で捨てない）
        state.memoData[state.currentItem.key] = bestPatientAnswer(state.currentItemAnswers);
        askOrFinish();
      }
    }
  } catch (err) {
    console.error('回答処理エラー:', err);
    // 失敗時も、聞き取れた発言があれば残す（無ければ不明）
    state.memoData[state.currentItem.key] = bestPatientAnswer(state.currentItemAnswers);
    askOrFinish();
  }
}

// 抽出に失敗した時の最終手段：患者が実際に話した内容を残す。
// 「わからない」等しか無ければ「不明」を返す。
function bestPatientAnswer(answers) {
  const texts = (answers || [])
    .map(a => String(a || '').trim())
    .filter(a => a && !/わからない|わかりません|覚えていない|思い出せ|不明/.test(a));
  if (!texts.length) return '不明';
  return texts.join('。').trim() || '不明';
}

function askOrFinish() {
  updateProgress();
  if (state.queue.length === 0) {
    finishInterview();
  } else {
    askNextItem();
  }
}

// 質問をスキップ（患者が答えたくない場合）
function skipCurrentItem() {
  if (!state.currentItem) return;
  state.memoData[state.currentItem.key] = '不明';
  askOrFinish();
}

// ---------- ⑤ メモ確定 ----------
function finishInterview() {
  const items = state.activeItems.map(it => ({
    key: it.key, label: it.label, icon: it.icon || '•',
    value: state.memoData[it.key] || '不明',
    highlight: !!it.highlight,
  }));
  // 患者が最初に話した内容の要約を【必ずメモ冒頭】に残す（抽出に失敗しても訴えを失わない）
  const summary = (state.initialSummary || state.fullTranscript || '').trim();
  if (summary) {
    items.unshift({
      key: '_initialSummary', label: '最初のお話（要約）', icon: '🗣️',
      value: summary, highlight: true,
    });
  }
  state.currentMemo = {
    id: makeMemoId(),                          // メモ固有のID（履歴の重複判定に使用）
    clinicId: state.template.clinicId,
    clinicName: state.template.clinicName,
    items,
    transcript: state.fullTranscript,
    createdAt: new Date().toISOString(),
  };
  // 完成したら履歴に保存し、下書きは破棄（＝完成メモへ昇格）
  saveMemo(true);
  clearDraft();
  renderMemo();
  showScreen('memo');
}

function renderMemo() {
  const memo = state.currentMemo;
  const date = new Date(memo.createdAt);
  setText('memo-date', formatDate(date));
  setText('memo-clinic', memo.clinicName);

  const list = document.getElementById('memo-list');
  list.innerHTML = '';
  memo.items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'memo-item' + (item.highlight ? ' highlight' : '');
    li.onclick = () => openEditModal(item.key, item.label, item.value);
    li.innerHTML = `
      <div class="memo-item-icon">${item.icon}</div>
      <div class="memo-item-body">
        <div class="memo-item-label">${escapeHtml(item.label)}</div>
        <div class="memo-item-value">${escapeHtml(item.value || '不明')}</div>
      </div>`;
    list.appendChild(li);
  });
}

// ---------- 編集モーダル ----------
function openEditModal(key, label, currentValue) {
  state.editingItemKey = key;
  setText('modal-title', label + ' を編集');
  document.getElementById('modal-input').value = (currentValue === '不明') ? '' : (currentValue || '');
  document.getElementById('modal-edit').classList.add('active');
  setTimeout(() => document.getElementById('modal-input').focus(), 100);
}

function closeEditModal() {
  document.getElementById('modal-edit').classList.remove('active');
  state.editingItemKey = null;
}

function saveEditModal() {
  const value = document.getElementById('modal-input').value.trim();
  if (state.editingItemKey && state.currentMemo) {
    const item = state.currentMemo.items.find(i => i.key === state.editingItemKey);
    if (item) item.value = value || '不明';
    state.memoData[state.editingItemKey] = value || '不明';
    renderMemo();
    closeEditModal();
    showToast('変更を保存しました');
  } else {
    closeEditModal();
  }
}

// ---------- ⑥ QRコード生成 ----------
function showQR() {
  // 履歴にも保存しておく
  saveMemo(true);

  const payload = buildQRPayload(state.currentMemo);
  const json = JSON.stringify(payload);
  const compressed = LZString.compressToEncodedURIComponent(json);

  const container = document.getElementById('qrcode');
  container.innerHTML = '';

  // QRに直接データを埋め込む（デモはサーバー不要方式）
  const len = compressed.length;
  const level = len < 700 ? 'M' : 'L';
  try {
    new QRCode(container, {
      text: compressed,
      width: 280,
      height: 280,
      correctLevel: QRCode.CorrectLevel[level],
    });
    setText('qr-size-note', `データ量: ${len} 文字`);
  } catch (e) {
    container.innerHTML = '<p style="color:#E55353;padding:20px;">QRの生成に失敗しました。メモの文字数が多すぎる可能性があります。項目を短く編集してください。</p>';
    console.error(e);
  }

  setText('qr-clinic', state.currentMemo.clinicName);
  showScreen('qr');
}

// QRに入れるデータ（受付アプリが解釈する形式）
function buildQRPayload(memo) {
  return {
    v: 1,                         // フォーマットバージョン
    c: memo.clinicId,             // クリニックID
    cn: memo.clinicName,          // クリニック名
    t: memo.createdAt,            // 作成日時
    // ラベルと値の配列（受付側で表示）
    items: memo.items.map(i => [i.label, i.value, i.highlight ? 1 : 0]),
  };
}

// ============================================
// OpenAI API 呼び出し（キー未設定時はモック）
// ============================================

// ---------- 音声ヘルパー（フォーマット判定・無音/幻聴対策） ----------
const MIN_AUDIO_BYTES = 800; // これ未満は実質無音とみなしWhisperに送らない

// 録音フォーマットに合った拡張子のファイル名を返す（Whisperは拡張子でも形式を判別するため重要）。
function audioFileName(blob) {
  const t = ((blob && blob.type) || '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'recording.mp4';
  if (t.includes('ogg')) return 'recording.ogg';
  if (t.includes('wav')) return 'recording.wav';
  if (t.includes('mpeg') || t.includes('mp3')) return 'recording.mp3';
  return 'recording.webm';
}

// 無音にWhisperが学習データから作文する「幻聴」を弾く（医療問診ではまず出ない定番フレーズ）。
function looksHallucinated(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return /ご(視聴|清聴)(いただき)?ありがとう|チャンネル登録|高評価|字幕|サブタイトル|thanks? for watching|please subscribe/i.test(t);
}

// ---------- Whisper（文字起こし） ----------
async function transcribeAudio(audioBlob, item) {
  if (!isLiveMode()) {
    await sleep(1500);
    if (state.recordingHandler === handleInitialAudio || !state._mockPattern) {
      // 初回：モックパターンを1つ選ぶ
      const p = MOCK_PATTERNS[Math.floor(Math.random() * MOCK_PATTERNS.length)];
      state._mockPattern = p;
      return p.transcript;
    }
    // 追加質問への回答（モック）
    if (item && state._mockPattern.mockAnswers[item.key]) {
      return state._mockPattern.mockAnswers[item.key];
    }
    return 'わかりません';
  }

  // 無音・短すぎる録音はWhisperに送らない（送ると学習データからの“幻聴”メモになる）
  if (!audioBlob || audioBlob.size < MIN_AUDIO_BYTES) return '';

  const formData = new FormData();
  formData.append('file', audioBlob, audioFileName(audioBlob));
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');

  // バックエンド経由なら /api/transcribe、未設定なら端末のキーで直接OpenAIへ
  const response = await fetch(apiEndpoint('audio/transcriptions'), {
    method: 'POST',
    headers: apiHeaders(),   // FormData なので Content-Type はブラウザに任せる
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Whisper API エラー: ${response.status} - ${await response.text()}`);
  }
  const result = await response.json();
  const text = result.text || '';
  if (looksHallucinated(text)) return ''; // 無音時の“幻聴”は聞き取れなかった扱い
  return text;
}

// ---------- 患者が最初に話した内容の要約（メモ冒頭に必ず残す） ----------
async function summarizeInitial(transcript) {
  if (!transcript) return '';
  if (!isLiveMode()) {
    // モック：発話そのものを要約代わりに使う
    return transcript;
  }
  const systemPrompt = `あなたは医療事前問診の補助AIです。患者が最初に話した内容を、医師がひと目で把握できる簡潔な日本語の要約（1〜2文）にまとめてください。
- 述べられた事実（症状・経過・期間・程度など）だけを含める。推測・診断はしない。
- 要約文のみを返す（前置きや注釈は不要）。`;
  try {
    const response = await fetch(apiEndpoint('chat/completions'), {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `患者の発話:\n「${transcript}」` },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) throw new Error(`GPT-4o API エラー: ${response.status}`);
    const result = await response.json();
    return (result.choices[0].message.content || transcript).trim();
  } catch (e) {
    console.error('要約エラー:', e);
    return transcript; // 失敗時は発話そのものを残す
  }
}

// ---------- 初回発話の解析＋深掘り質問の立案（1回のAI呼び出しで実施） ----------
// ①基本項目の抽出（断片でも取りこぼさない）と、②まだ話していないことだけの深掘り質問を、
// 同じ発話に対する1回の判断でまとめて行う。これにより「既に話したことを聞き返す」を防ぐ。
// 戻り値: { filled: {項目key: 抽出文字列|null}, questions: [{label, question}] }
async function analyzeAndPlan(transcript, items) {
  if (!isLiveMode()) {
    await sleep(1500);
    // モックは従来どおり（深掘りは conditionalGroups 側で処理するため空）
    return { filled: (state._mockPattern && state._mockPattern.filled) || {}, questions: [] };
  }

  const itemList = items.map(i => `- ${i.key}: ${i.label}（${i.question}）`).join('\n');
  const systemPrompt = `あなたは医療事前問診の補助AIです。患者の最初の自由な発話を読み、次の2つを同時に行います。

【作業1：基本項目の抽出】
以下の各項目について、発話の中で患者が「少しでも触れている」内容を抜き出します。
${itemList}
- 患者が少しでも触れた項目は、完全な文でなくても、患者の言葉のまま抽出する（例：「3か月前から」「ズキズキする」「後頭部」などの断片でも必ず抽出する）。
- 数値・時間・固有名詞（「38.5度」「昨夜21時ごろ」など）はそのまま残す。
- その項目について発話で「一切触れていない」ときだけ null にする。迷う場合は、述べられた言葉をそのまま入れる（取りこぼさない）。
- ただし、患者が述べていない内容を推測で作ってはいけない（捏造禁止）。曖昧なら患者の言葉のまま短く入れる。

【作業2：深掘り質問の作成】
患者の主訴を医学的に具体化するための追加質問を作ります。
- 患者が実際に話した症状に沿った質問だけにする。話していないこと（痛みの話が無いのに痛みの強さ等）は聞かない。
- 【最重要】作業1で抽出できた内容（＝患者が既に話したこと）は、絶対に質問しない。まだ話していない点だけを質問する。
- 基本項目と重複しない。優先度の高い順に最大3つ（少なくてもよい／無ければ空配列）。
- 患者本人がやさしく答えられる、平易で短い日本語の口語。各質問に短いラベル（5〜12文字。例「痛みの強さ」「経過の様子」）を付ける。
- 診断・治療の提案はしない。

【出力】次のJSONのみを返す（説明文は不要）。値はすべて日本語。
{"filled": {"項目key": "抽出文字列 または null"}, "questions": [{"label": "短いラベル", "question": "質問文"}]}`;

  try {
    const response = await fetch(apiEndpoint('chat/completions'), {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `患者の発話:\n「${transcript}」` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    if (!response.ok) {
      throw new Error(`GPT-4o API エラー: ${response.status} - ${await response.text()}`);
    }
    const result = await response.json();
    const parsed = JSON.parse(result.choices[0].message.content) || {};
    return {
      filled: (parsed.filled && typeof parsed.filled === 'object') ? parsed.filled : {},
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    };
  } catch (e) {
    // 解析に失敗してもフローは止めない（基本項目をそのまま質問して続行）
    console.error('初回解析エラー（基本項目で続行）:', e);
    return { filled: {}, questions: [] };
  }
}

// ---------- 追加質問への回答を評価して値を抽出 ----------
async function evaluateAnswer(item, answerTranscript) {
  // 明確な否定回答（「いいえ」「ありません」「ないです」等）は確実に「なし」と判定する。
  // モデルに依存せず、聞き直し・不明への誤判定を防ぐ。
  if (isClearNegative(answerTranscript)) return 'なし';

  if (!isLiveMode()) {
    await sleep(1000);
    // モック：回答がそのまま値になる（「わかりません」系は null）
    if (/わかりません|わからない|不明/.test(answerTranscript)) return null;
    return answerTranscript;
  }

  const systemPrompt = `あなたは医療事前問診の補助AIです。
問診項目「${item.label}」について、AIが「${item.question}」と質問し、患者が音声で回答しました（聞き直した場合は複数回の発言が「。」で連結されています）。
その回答から、この項目に記載すべき内容を抽出してください。

【ルール】
- 回答に少しでも関連する情報があれば、たとえ断片的・曖昧でも、患者が言ったことを尊重して value にまとめる（数値や固有名詞は残す）。完璧な情報でなくてよい。
- 聞き直した複数回の発言は合わせて解釈し、後の発言で補足された内容も反映する。
- 「いいえ」「ありません」「ないです」「特にない」「問題ありません」など【明確な否定】は有効な回答。value を「なし」とする（絶対に null にしない）。
- value を null にしてよいのは、本人が「わからない」「覚えていない」と述べた場合や、発言がこの項目と全く無関係で関連情報が一切読み取れない場合【だけ】。少しでも関連する内容があれば null にしない。
- 推測で大きく補わない。診断・治療提案はしない。

【例】
- 回答「いいえ、ありません」→ {"value": "なし"}
- 回答「特に飲んでいる薬はないです」→ {"value": "なし"}
- 回答「降圧薬を毎日飲んでいます」→ {"value": "降圧薬を毎日服用"}
- 回答「3日前くらい。だんだん強くなった」→ {"value": "3日前ごろから、だんだん強くなった"}
- 回答「うーん、ちょっとわからないです」→ {"value": null}

【出力】 {"value": 文字列 または null} の JSON のみ。`;

  const response = await fetch(apiEndpoint('chat/completions'), {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `患者の回答:\n「${answerTranscript}」` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    throw new Error(`GPT-4o API エラー: ${response.status} - ${await response.text()}`);
  }
  const result = await response.json();
  const parsed = JSON.parse(result.choices[0].message.content);
  return parsed.value;
}

// 明確な否定回答かどうかを判定する（「なし」と確定してよい回答）。
// 「わからない（不明）」や、具体的な情報を含む回答は対象外（false）にして、
// 通常処理に委ねる。誤って情報を握りつぶさないよう保守的に判定する。
function isClearNegative(text) {
  const t = String(text || '').replace(/[\s　、。!！?？.,]/g, '');
  if (!t) return false;
  // 「わからない・不明・覚えていない」は否定（なし）ではなく不明扱い
  if (/(わからな|わかりませ|不明|覚えてい?ない|記憶にない|思い出せ)/.test(t)) return false;
  // 肯定・具体情報を含む場合は短絡しない（例:「薬を飲んでいます」「38度あります」）
  if (/(はい|あります|います|服用|服薬|通院|持病|飲んでいます|使ってい|やってい|[0-9０-９])/.test(t)) return false;
  // 明確な否定表現
  return /(いいえ|いえ|ありません|ございません|ないです|ない$|^なし$|なしです|特にない|特になし|特には|いません|問題ありません|問題ない|大丈夫)/.test(t);
}

// 明確な「わからない／不明」回答かどうか（聞き直さず「不明」で確定してよい回答）。
// 数値や具体的な訴えを含む場合は false にして、情報を握りつぶさない。
function isClearUnknown(text) {
  const t = String(text || '').replace(/[\s　、。!！?？.,]/g, '');
  if (!t) return false;
  if (/[0-9０-９]/.test(t)) return false; // 数値があれば具体回答とみなす
  // 具体的な訴え・肯定を含む場合は不明として握りつぶさない
  if (/(痛|つら|苦し|あります|います|出てい|腫れ|咳|吐き|下痢|めまい|しびれ|だるい|熱っぽ)/.test(t)) return false;
  return /(わからな|わかりませ|分からな|分かりませ|不明|覚えてい?ない|記憶にない|思い出せ|知らない|測ってい?ない|計ってい?ない|はかってい?ない)/.test(t);
}

// ============================================
// 履歴
// ============================================
function saveMemo(silent) {
  if (!state.currentMemo) return;
  if (!state.currentMemo.id) state.currentMemo.id = makeMemoId(); // 旧データ救済
  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  // 同一メモの二重保存を避ける（メモ固有IDで判定）
  if (!history.some(h => h.id === state.currentMemo.id)) {
    history.unshift({ ...state.currentMemo });
    if (history.length > 50) history.length = 50;
    localStorage.setItem('memo_history', JSON.stringify(history));
  }
  if (!silent) showToast('メモを保存しました');
}

// メモ固有のID（時刻＋乱数で衝突しない）
function makeMemoId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ============================================
// 下書き（途中保存）と再開
// ============================================
// 問診の途中状態を端末に保存し、中断後に「続きから」再開できるようにする。
// 時間では消えない（数時間後の提出にも対応）。完了 or 明示的な破棄でのみ消える。
const DRAFT_KEY = 'memo_draft';

function saveDraft() {
  try {
    const draft = {
      clinicId: state.template.clinicId,
      activeItems: state.activeItems,
      memoData: state.memoData,
      queue: state.queue,
      currentItem: state.currentItem,
      fullTranscript: state.fullTranscript,
      initialSummary: state.initialSummary || '',
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (e) {
    console.error('下書き保存エラー:', e);
  }
}

function loadDraft() {
  try {
    const d = localStorage.getItem(DRAFT_KEY);
    const draft = d ? JSON.parse(d) : null;
    if (!draft || !Array.isArray(draft.activeItems) || draft.activeItems.length === 0) return null;
    return draft;
  } catch (e) {
    return null;
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

// 下書きから問診を再開する
function resumeInterview() {
  const draft = loadDraft();
  if (!draft) { showToast('続きのデータが見つかりませんでした'); refreshStartScreen(); return; }

  state.template = CLINIC_TEMPLATES[draft.clinicId] || state.template;
  state.activeItems = draft.activeItems || [];
  state.memoData = draft.memoData || {};
  state.queue = draft.queue || [];
  state.attemptCount = 0;
  state.fullTranscript = draft.fullTranscript || '';
  state.initialSummary = draft.initialSummary || '';
  state.currentMemo = null;
  state.editingItemKey = null;
  state.currentItem = null;
  state._mockPattern = null;
  // 中断時に提示中だった質問が未回答なら、先頭に戻して聞き直す
  if (draft.currentItem && !state.memoData[draft.currentItem.key]) {
    state.queue.unshift(draft.currentItem);
  }
  state.recordingHandler = handleFollowupAudio;
  startFollowup(); // 残りの質問から再開（無ければ確定画面へ）
}

// 直近に作成した完成メモのQRを再表示（受付で出し直す用）
function showLastMemoQR() {
  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  if (!history.length) { showToast('表示できるメモがありません'); refreshStartScreen(); return; }
  state.currentMemo = history[0];
  showQR();
}

// スタート画面のボタンを、下書き・直近メモの有無に応じて出し分ける
function refreshStartScreen() {
  const draft = loadDraft();
  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  const last = history[0];

  const resumeBtn = document.getElementById('resume-btn');
  if (resumeBtn) {
    if (draft) {
      const total = draft.activeItems.length;
      const answered = draft.activeItems.filter(it => draft.memoData && draft.memoData[it.key]).length;
      const chief = (draft.memoData && draft.memoData.chiefComplaint)
        || (draft.fullTranscript ? draft.fullTranscript.slice(0, 16) : '問診');
      resumeBtn.innerHTML = `⏯ 前回の続きから<br><span style="font-size:12px;opacity:.85;">${escapeHtml(chief)}・${answered}/${total}項目</span>`;
      resumeBtn.style.display = 'block';
    } else {
      resumeBtn.style.display = 'none';
    }
  }

  const lastQrBtn = document.getElementById('last-qr-btn');
  if (lastQrBtn) {
    lastQrBtn.style.display = last ? 'block' : 'none';
  }
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  const container = document.getElementById('history-container');
  if (history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div>まだメモがありません</div>
      </div>`;
    return;
  }
  const list = document.createElement('ul');
  list.className = 'history-list';
  history.forEach(memo => {
    const chief = (memo.items && memo.items[0] && memo.items[0].value) || '無題';
    const li = document.createElement('li');
    li.className = 'history-item';
    li.onclick = () => { state.currentMemo = memo; renderMemo(); showScreen('memo'); };
    li.innerHTML = `
      <div class="history-item-date">${formatDate(new Date(memo.createdAt))}</div>
      <div class="history-item-title">${escapeHtml(chief)}</div>
      <div class="history-item-preview">${escapeHtml(memo.clinicName || '')}</div>`;
    list.appendChild(li);
  });
  container.innerHTML = '';
  container.appendChild(list);
}

function clearHistory() {
  if (confirm('全ての履歴を削除します。よろしいですか？')) {
    localStorage.removeItem('memo_history');
    showToast('履歴を削除しました');
  }
}

// ============================================
// ユーティリティ
// ============================================
function isUnknown(v) {
  // 「なし」「特になし」は患者の明確な否定回答（＝有効な答え）なので不明扱いしない
  return ['不明', '聞き取れず', 'null'].includes(String(v).trim());
}

function formatDate(date) {
  return `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ` +
         `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
}

function setLoadingText(title, sub) {
  setText('loading-text', title);
  setText('loading-sub', sub);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
