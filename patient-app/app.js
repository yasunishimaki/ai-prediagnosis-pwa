// ============================================
// AI事前問診メモ - デモ版（7月2日 クレアスクリニック）
// 自由発話 → AIが不足項目を音声で追加質問 → メモ確定 → QR表示
// ============================================

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
  if (state.apiKey) {
    if (badge) { badge.textContent = '本番API'; badge.className = 'mode-badge api'; }
    if (modeText) modeText.textContent = '🟢 OpenAI API';
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
  state.activeItems = [];
  state.memoData = {};
  state.queue = [];
  state.currentItem = null;
  state.fullTranscript = '';
  state._mockPattern = null;
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
    state.fullTranscript = transcript;

    // 主訴別グループの判定（最初の発話にキーワードが含まれるか）
    buildActiveItems(transcript);

    setLoadingText('内容を整理しています', '不足している項目を確認中...');
    const filled = await analyzeInitial(transcript, state.activeItems);

    // 結果を memoData に反映し、不足項目を queue に積む
    state.queue = [];
    state.activeItems.forEach(item => {
      const v = filled[item.key];
      if (v && String(v).trim() && !isUnknown(v)) {
        state.memoData[item.key] = String(v).trim();
      } else {
        state.queue.push(item);
      }
    });

    startFollowup();
  } catch (err) {
    console.error('処理エラー:', err);
    alert('処理中にエラーが発生しました:\n' + err.message);
    showScreen('start');
  }
}

function buildActiveItems(transcript) {
  const t = state.template;
  const items = [...t.coreItems];
  t.conditionalGroups.forEach(group => {
    if (group.match.some(kw => transcript.includes(kw))) {
      group.items.forEach(it => items.push(it));
    }
  });
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
  state.recordingHandler = handleFollowupAudio;
  renderFollowupQuestion(state.currentItem.question, false);
  showScreen('followup');
  resetRecording();
  updateProgress();
}

function renderFollowupQuestion(question, isReprompt) {
  setText('followup-label', state.currentItem.label);
  setText('followup-question', question);
  const hint = document.getElementById('followup-hint');
  if (hint) {
    hint.textContent = isReprompt
      ? 'もう少し具体的に教えてください。わからない場合はそのままお話しください。'
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
    const value = await evaluateAnswer(state.currentItem, answer);

    if (value && !isUnknown(value)) {
      state.memoData[state.currentItem.key] = String(value).trim();
      askOrFinish();
    } else {
      state.attemptCount++;
      if (state.attemptCount < MAX_FOLLOWUP_ATTEMPTS) {
        // もう1回だけ聞き直す
        state.recordingHandler = handleFollowupAudio;
        renderFollowupQuestion('もう少し具体的に教えていただけますか？', true);
        showScreen('followup');
        resetRecording();
      } else {
        // 2回試して埋まらなければ「不明」で記録し次へ
        state.memoData[state.currentItem.key] = '不明';
        askOrFinish();
      }
    }
  } catch (err) {
    console.error('回答処理エラー:', err);
    // 失敗時は不明扱いにして進める（デモを止めない）
    state.memoData[state.currentItem.key] = '不明';
    askOrFinish();
  }
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
  state.currentMemo = {
    clinicId: state.template.clinicId,
    clinicName: state.template.clinicName,
    items: state.activeItems.map(it => ({
      key: it.key, label: it.label, icon: it.icon || '•',
      value: state.memoData[it.key] || '不明',
      highlight: !!it.highlight,
    })),
    transcript: state.fullTranscript,
    createdAt: new Date().toISOString(),
  };
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

// ---------- Whisper（文字起こし） ----------
async function transcribeAudio(audioBlob, item) {
  if (!state.apiKey) {
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

  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${state.apiKey}` },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Whisper API エラー: ${response.status} - ${await response.text()}`);
  }
  const result = await response.json();
  return result.text;
}

// ---------- 初回発話の分析（どの項目が埋まっているか） ----------
async function analyzeInitial(transcript, items) {
  if (!state.apiKey) {
    await sleep(1500);
    return (state._mockPattern && state._mockPattern.filled) || {};
  }

  const itemList = items.map(i => `- ${i.key}: ${i.label}（${i.question}）`).join('\n');
  const systemPrompt = `あなたは医療事前問診の補助AIです。患者の最初の自由な発話から、以下の問診項目それぞれについて、発話内で語られている情報を抽出します。

【問診項目】
${itemList}

【ルール】
- 各項目について、発話から読み取れる内容を「医師が読んで分かる必要十分な文」でまとめる。単語ではなく具体的に。
- 数値・固有名詞・時間表現（「38.5度」「昨夜21時ごろ」など）はそのまま残す。
- 発話内に該当する情報が無い項目は、値を null にする（推測で埋めない）。
- 診断・治療の提案はしない。患者の言葉を尊重する。

【出力】
キーを項目key、値を抽出文字列または null とする JSON オブジェクトのみを返す。`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `患者の発話:\n「${transcript}」` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    throw new Error(`GPT-4o API エラー: ${response.status} - ${await response.text()}`);
  }
  const result = await response.json();
  return JSON.parse(result.choices[0].message.content);
}

// ---------- 追加質問への回答を評価して値を抽出 ----------
async function evaluateAnswer(item, answerTranscript) {
  if (!state.apiKey) {
    await sleep(1000);
    // モック：回答がそのまま値になる（「わかりません」系は null）
    if (/わかりません|わからない|不明/.test(answerTranscript)) return null;
    return answerTranscript;
  }

  const systemPrompt = `あなたは医療事前問診の補助AIです。
問診項目「${item.label}」について、AIが「${item.question}」と質問し、患者が音声で回答しました。
その回答から、この項目に記載すべき内容を抽出してください。

【ルール】
- 回答が項目に答えている場合：医師が読んで分かる必要十分な文で value にまとめる（数値や固有名詞は残す）。「特にない」旨ならその内容（例:「特になし」）を value に入れる。
- 回答が質問に答えていない／「わからない」等で内容が不明な場合：value を null にする。
- 推測で補わない。診断・治療提案はしない。

【出力】 {"value": 文字列 または null} の JSON のみ。`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json',
    },
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

// ============================================
// 履歴
// ============================================
function saveMemo(silent) {
  if (!state.currentMemo) return;
  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  // 同一メモの二重保存を避ける
  if (!history.some(h => h.createdAt === state.currentMemo.createdAt)) {
    history.unshift({ ...state.currentMemo, id: Date.now().toString() });
    if (history.length > 50) history.length = 50;
    localStorage.setItem('memo_history', JSON.stringify(history));
  }
  if (!silent) showToast('メモを保存しました');
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
