// ============================================
// AI事前問診メモ - Phase 0 プロトタイプ
// 本物のOpenAI API呼び出し + キー未入力時モック動作
// ============================================

// ---------- 状態管理 ----------
const state = {
  apiKey: null,
  mediaRecorder: null,
  audioChunks: [],
  audioBlob: null,
  recordingStartTime: null,
  recordingTimerId: null,
  currentMemo: null,
  editingItemKey: null,
  isRecording: false,
};

// ---------- モックデータ ----------
const MOCK_PATTERNS = [
  {
    transcript: "昨日の夜寝る前くらいから、頭がズキズキ痛むんです。それで、吐き気もあって。降圧薬は毎日飲んでます。アレルギーは特にありません。",
    memo: {
      chiefComplaint: "頭痛",
      onset: "昨日の夜から",
      quality: "ズキズキする",
      medication: "降圧薬（毎日服用）",
      allergy: "なし",
      other: "吐き気あり"
    }
  },
  {
    transcript: "今朝から、お腹が痛くて。だんだん痛みが強くなってきました。朝食を食べたあとから始まりました。お薬は飲んでいません。エビとカニのアレルギーがあります。",
    memo: {
      chiefComplaint: "お腹の痛み",
      onset: "今朝から",
      quality: "鈍い痛み、徐々に強く",
      medication: "特になし",
      allergy: "甲殻類（エビ・カニ）",
      other: "朝食後から症状あり"
    }
  },
  {
    transcript: "昨日の夕方くらいから熱が出始めて、今38度5分くらいあります。喉も痛いし、咳も少し出ます。市販の解熱剤を1回飲みました。アレルギーはありません。",
    memo: {
      chiefComplaint: "発熱",
      onset: "昨日の夕方から",
      quality: "38.5度、上下する",
      medication: "市販の解熱剤を1回服用",
      allergy: "なし",
      other: "喉の痛み、咳あり"
    }
  },
  {
    transcript: "1週間くらい前から咳が止まらないんです。痰がからむような咳で、特に夜がひどいです。市販の咳止めを飲んでいます。微熱もあるかもしれません。",
    memo: {
      chiefComplaint: "咳が止まらない",
      onset: "1週間前から",
      quality: "痰のからむ咳、特に夜間",
      medication: "市販の咳止め",
      allergy: "なし",
      other: "微熱あり、倦怠感"
    }
  },
  {
    transcript: "3日前に重い荷物を持ち上げてから、腰が痛くて。動くと痛みます。鈍い痛みです。湿布を貼って様子を見ていました。お薬は飲んでいません。",
    memo: {
      chiefComplaint: "腰の痛み",
      onset: "3日前から",
      quality: "動くと痛む、鈍痛",
      medication: "湿布を使用中",
      allergy: "なし",
      other: "重い荷物を持った後から発症"
    }
  }
];

// ---------- 初期化 ----------
window.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  updateModeBadge();
  registerServiceWorker();
});

// ---------- Service Worker登録 ----------
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

  // 画面別の初期化処理
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
    if (badge) {
      badge.textContent = '本番API';
      badge.className = 'mode-badge api';
    }
    if (modeText) modeText.textContent = '🟢 OpenAI API';
  } else {
    if (badge) {
      badge.textContent = 'モック';
      badge.className = 'mode-badge mock';
    }
    if (modeText) modeText.textContent = '🟡 モック動作';
  }
}

// ---------- 録音処理 ----------
async function startRecording() {
  showScreen('recording');
  resetRecording();
}

function resetRecording() {
  state.isRecording = false;
  state.audioChunks = [];
  state.audioBlob = null;
  document.getElementById('mic-button').classList.remove('recording');
  document.getElementById('mic-button').innerHTML = '🎤';
  document.getElementById('recording-timer').style.display = 'none';
  document.getElementById('wave-bars').style.display = 'none';
  document.getElementById('recording-prompt').innerHTML = 'マイクボタンを押して<br>症状をお話しください';
  document.getElementById('recording-status').textContent = '話す内容の例: 「昨日の夜から頭が痛くて、ズキズキする感じです。吐き気もあります。」';
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

    // MIMEタイプ選択（ブラウザ互換性）
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
      processAudio();
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    state.recordingStartTime = Date.now();

    // UI更新
    document.getElementById('mic-button').classList.add('recording');
    document.getElementById('mic-button').innerHTML = '⏸';
    document.getElementById('recording-timer').style.display = 'block';
    document.getElementById('wave-bars').style.display = 'flex';
    document.getElementById('recording-prompt').innerHTML = '録音中です...<br>話し終わったらボタンを押してください';
    document.getElementById('recording-status').textContent = '🔴 録音中';

    // タイマー更新
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
  document.getElementById('recording-timer').textContent = `${m}:${s}`;
}

// ---------- 音声処理（API or モック） ----------
async function processAudio() {
  showScreen('loading');
  resetLoadingSteps();

  try {
    // Step 1: 文字起こし
    setStepActive('step-transcribe');
    const transcript = await transcribeAudio(state.audioBlob);
    setStepDone('step-transcribe');

    // Step 2: 要約・分類
    setStepActive('step-summarize');
    const memo = await summarizeTranscript(transcript);
    setStepDone('step-summarize');

    // Step 3: メモ生成
    setStepActive('step-format');
    await sleep(500);
    setStepDone('step-format');

    state.currentMemo = {
      ...memo,
      transcript: transcript,
      createdAt: new Date().toISOString()
    };

    // 主訴確認画面へ
    setTimeout(() => {
      document.getElementById('confirm-chiefcomplaint').textContent = memo.chiefComplaint;
      showScreen('confirm');
    }, 600);

  } catch (err) {
    console.error('処理エラー:', err);
    alert('処理中にエラーが発生しました:\n' + err.message);
    showScreen('start');
  }
}

function resetLoadingSteps() {
  ['step-transcribe', 'step-summarize', 'step-format'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('active', 'done');
    el.querySelector('.status').textContent = '⏳';
  });
}

function setStepActive(id) {
  const el = document.getElementById(id);
  el.classList.add('active');
  el.querySelector('.status').textContent = '⚙️';
}

function setStepDone(id) {
  const el = document.getElementById(id);
  el.classList.remove('active');
  el.classList.add('done');
  el.querySelector('.status').textContent = '✓';
}

// ---------- Whisper API 呼び出し ----------
async function transcribeAudio(audioBlob) {
  // モックモード
  if (!state.apiKey) {
    await sleep(2500); // 実APIのレスポンス時間をシミュレート
    const pattern = MOCK_PATTERNS[Math.floor(Math.random() * MOCK_PATTERNS.length)];
    state._mockPattern = pattern; // 後段で同じパターンを使う
    return pattern.transcript;
  }

  // 本番API
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API エラー: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.text;
}

// ---------- GPT-4o による要約 ----------
async function summarizeTranscript(transcript) {
  // モックモード
  if (!state.apiKey) {
    await sleep(3000);
    if (state._mockPattern) {
      return state._mockPattern.memo;
    }
    // フォールバック
    return MOCK_PATTERNS[0].memo;
  }

  // 本番API
  const systemPrompt = `あなたは医療事前問診のメモを作成するAIアシスタントです。
患者の発話から、以下の項目を抽出してJSON形式で返してください。
情報がない項目は「不明」または「特になし」と記載してください。

抽出項目:
- chiefComplaint: 主訴（一番つらい症状を簡潔に。例: 「頭痛」「お腹の痛み」）
- onset: 発症時期（例: 「昨日の夜から」「3日前から」）
- quality: 症状の性質（例: 「ズキズキする」「鈍い痛み」）
- medication: 服用中の薬（例: 「降圧薬」「特になし」）
- allergy: アレルギー（例: 「甲殻類」「なし」）
- other: その他の重要情報（随伴症状、きっかけなど）

注意:
- 患者の言葉を尊重し、過剰な解釈はしない
- 診断や治療の提案はしない
- 簡潔で分かりやすい日本語で記載`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `次の患者の発話を整理してください:\n\n「${transcript}」` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GPT-4o API エラー: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const content = result.choices[0].message.content;
  return JSON.parse(content);
}

// ---------- 主訴確認 ----------
function confirmChiefComplaint(isConfirmed) {
  if (isConfirmed) {
    renderMemo();
    showScreen('memo');
  } else {
    // 修正モード
    openEditModal('chiefComplaint', '主訴', state.currentMemo.chiefComplaint);
  }
}

// ---------- メモ表示 ----------
function renderMemo() {
  const memo = state.currentMemo;
  const date = new Date(memo.createdAt);
  document.getElementById('memo-date').textContent =
    `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ` +
    `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

  const items = [
    { key: 'chiefComplaint', label: '主訴', icon: '🎯', value: memo.chiefComplaint, highlight: false },
    { key: 'onset', label: '発症', icon: '📅', value: memo.onset, highlight: false },
    { key: 'quality', label: '症状の性質', icon: '🔍', value: memo.quality, highlight: false },
    { key: 'medication', label: '服薬', icon: '💊', value: memo.medication, highlight: true },
    { key: 'allergy', label: 'アレルギー', icon: '⚠️', value: memo.allergy, highlight: true },
    { key: 'other', label: 'その他', icon: '📌', value: memo.other, highlight: false },
  ];

  const list = document.getElementById('memo-list');
  list.innerHTML = '';

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'memo-item' + (item.highlight ? ' highlight' : '');
    li.onclick = () => openEditModal(item.key, item.label, item.value);
    li.innerHTML = `
      <div class="memo-item-icon">${item.icon}</div>
      <div class="memo-item-body">
        <div class="memo-item-label">${item.label}</div>
        <div class="memo-item-value">${escapeHtml(item.value || '不明')}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

// ---------- インライン編集モーダル ----------
function openEditModal(key, label, currentValue) {
  state.editingItemKey = key;
  document.getElementById('modal-title').textContent = label + ' を編集';
  document.getElementById('modal-input').value = currentValue || '';
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
    state.currentMemo[state.editingItemKey] = value || '不明';

    // 主訴を編集した場合は確認画面に戻る、それ以外はメモ画面更新
    if (state.editingItemKey === 'chiefComplaint' &&
        document.getElementById('screen-confirm').classList.contains('active')) {
      document.getElementById('confirm-chiefcomplaint').textContent = value;
      closeEditModal();
      renderMemo();
      showScreen('memo');
    } else {
      renderMemo();
      closeEditModal();
    }
    showToast('変更を保存しました');
  } else {
    closeEditModal();
  }
}

// ---------- メモを保存 ----------
function saveMemo() {
  if (!state.currentMemo) return;

  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  history.unshift({
    ...state.currentMemo,
    id: Date.now().toString()
  });

  // 最大50件保持
  if (history.length > 50) history.length = 50;

  localStorage.setItem('memo_history', JSON.stringify(history));
  showToast('メモを保存しました');
}

// ---------- メモを送信（Web Share API） ----------
async function shareMemo() {
  if (!state.currentMemo) return;

  const text = formatMemoForShare(state.currentMemo);

  if (navigator.share) {
    // Web Share API 対応
    try {
      await navigator.share({
        title: 'AI事前問診メモ',
        text: text
      });
      showToast('送信しました');
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('共有エラー:', err);
        // フォールバック
        await copyToClipboard(text);
      }
    }
  } else {
    // Web Share API 非対応 → クリップボードコピー
    await copyToClipboard(text);
  }
}

function formatMemoForShare(memo) {
  const date = new Date(memo.createdAt);
  const dateStr = `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ` +
                  `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

  return `【AI事前問診メモ】
作成日時: ${dateStr}

・主訴: ${memo.chiefComplaint || '不明'}
・発症: ${memo.onset || '不明'}
・性質: ${memo.quality || '不明'}
・服薬: ${memo.medication || '不明'}
・アレルギー: ${memo.allergy || '不明'}
・その他: ${memo.other || 'なし'}

※このメモは患者本人がAIで整理したものです。
※診療のヒアリングは医療機関で改めて実施されます。`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('クリップボードにコピーしました\nLINEに貼り付けて送信してください');
  } catch (err) {
    // 古いブラウザ向け
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('クリップボードにコピーしました');
  }
}

// ---------- 履歴表示 ----------
function renderHistory() {
  const history = JSON.parse(localStorage.getItem('memo_history') || '[]');
  const container = document.getElementById('history-container');

  if (history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div>まだメモがありません</div>
        <div style="margin-top: 8px; font-size: 13px;">「症状を話す」からメモを作成してください</div>
      </div>
    `;
    return;
  }

  const list = document.createElement('ul');
  list.className = 'history-list';

  history.forEach(memo => {
    const date = new Date(memo.createdAt);
    const dateStr = `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ` +
                    `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

    const li = document.createElement('li');
    li.className = 'history-item';
    li.onclick = () => {
      state.currentMemo = memo;
      renderMemo();
      showScreen('memo');
    };
    li.innerHTML = `
      <div class="history-item-date">${dateStr}</div>
      <div class="history-item-title">${escapeHtml(memo.chiefComplaint || '無題')}</div>
      <div class="history-item-preview">${escapeHtml((memo.quality || '') + ' / ' + (memo.onset || ''))}</div>
    `;
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

// ---------- 各種ユーティリティ ----------
function resetAndStart() {
  state.currentMemo = null;
  startRecording();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
