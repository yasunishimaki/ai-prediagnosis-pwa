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
      chiefComplaint: "後頭部の頭痛と吐き気",
      onset: "昨日の夜、寝る前ごろから",
      course: "夜から続いており、横になっても治まらない",
      quality: "後頭部がズキズキと拍動するように痛む",
      severity: "吐き気を伴い、横になっていてもつらい",
      trigger: "はっきりしたきっかけは話されていない",
      associated: "吐き気あり",
      medication: "降圧薬を毎日服用",
      allergy: "特になし",
      history: "高血圧（降圧薬服用中）",
      concern: "特になし",
      other: "特になし"
    }
  },
  {
    transcript: "今朝から、お腹が痛くて。だんだん痛みが強くなってきました。朝食を食べたあとから始まりました。お薬は飲んでいません。エビとカニのアレルギーがあります。",
    memo: {
      chiefComplaint: "腹痛",
      onset: "今朝、朝食を食べたあとから",
      course: "時間とともに徐々に痛みが強くなっている",
      quality: "お腹が鈍く痛む",
      severity: "だんだん我慢しづらくなってきている",
      trigger: "朝食を食べたあとから始まった",
      associated: "特になし",
      medication: "特になし",
      allergy: "甲殻類（エビ・カニ）",
      history: "特になし",
      concern: "特になし",
      other: "特になし"
    }
  },
  {
    transcript: "昨日の夕方くらいから熱が出始めて、今38度5分くらいあります。喉も痛いし、咳も少し出ます。市販の解熱剤を1回飲みました。アレルギーはありません。",
    memo: {
      chiefComplaint: "発熱（38.5度）",
      onset: "昨日の夕方ごろから",
      course: "昨夕から発熱が続き、現在38.5度",
      quality: "熱っぽさに加え喉の痛みあり",
      severity: "解熱剤を要する程度の発熱",
      trigger: "はっきりしたきっかけは話されていない",
      associated: "喉の痛み、軽い咳",
      medication: "市販の解熱剤を1回服用",
      allergy: "特になし",
      history: "特になし",
      concern: "特になし",
      other: "特になし"
    }
  },
  {
    transcript: "1週間くらい前から咳が止まらないんです。痰がからむような咳で、特に夜がひどいです。市販の咳止めを飲んでいます。微熱もあるかもしれません。",
    memo: {
      chiefComplaint: "止まらない咳",
      onset: "1週間ほど前から",
      course: "1週間続いており、特に夜間にひどくなる",
      quality: "痰がからむような咳",
      severity: "夜間に咳き込み、倦怠感もある",
      trigger: "夜になると悪化する",
      associated: "微熱の可能性、倦怠感",
      medication: "市販の咳止めを服用中",
      allergy: "特になし",
      history: "特になし",
      concern: "特になし",
      other: "特になし"
    }
  },
  {
    transcript: "3日前に重い荷物を持ち上げてから、腰が痛くて。動くと痛みます。鈍い痛みです。湿布を貼って様子を見ていました。お薬は飲んでいません。",
    memo: {
      chiefComplaint: "腰の痛み",
      onset: "3日前、重い荷物を持ち上げたとき",
      course: "3日間続いており、湿布で様子を見ている",
      quality: "腰が鈍く痛む",
      severity: "体を動かすと痛みが強くなる",
      trigger: "重い荷物を持ち上げた直後から発症。動作で悪化",
      associated: "特になし",
      medication: "湿布を使用中（内服薬はなし）",
      allergy: "特になし",
      history: "特になし",
      concern: "特になし",
      other: "特になし"
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
  const systemPrompt = `あなたは、医師が短時間で患者の状態を把握できるようにするための「事前問診メモ」を作成するAIアシスタントです。
患者の発話から情報を整理し、以下の項目をJSON形式で返してください。

【最重要の原則】
- 患者が話した情報は省略しないこと。発話に含まれる症状・時期・程度・回数・経過・きっかけ・心配ごとなどを取りこぼさず該当項目に振り分ける。
- 単語ではなく、医師が読んで状況が分かる「必要十分な文」で記載する（例: ×「頭痛」 ○「後頭部がズキズキ痛む。拍動性で、夜間に強くなる」）。
- 数値・固有名詞・時間表現（「38.5度」「降圧薬を朝1錠」「昨夜21時ごろ」など）はそのまま残す。
- 患者本人の表現・ニュアンスを尊重し、勝手に医学用語へ言い換えたり、診断・重症度を断定しない。
- 発話に該当情報がない項目のみ「特になし」または「聞き取れず」と記載する（言及があるのに空欄にしない）。

【抽出項目】
- chiefComplaint: 主訴。一番つらい・受診の主目的となる症状（簡潔な見出し。例:「後頭部の頭痛と吐き気」）
- onset: いつから始まったか（例:「昨夜寝る前ごろから」「3日前の朝から」）
- course: 発症からの経過・変化（悪化/改善/変動、頻度やパターン。例:「徐々に強くなっている」「波があり食後に悪化」）
- quality: 症状の性質・部位（どこが・どんな痛み/感じか。例:「右下腹部がキリキリ刺すように痛む」）
- severity: つらさの程度・日常生活への影響（例:「歩くと痛みで前かがみになる」「眠れないほど」「我慢できる程度」）
- trigger: きっかけ・悪化要因・軽快要因（例:「重い荷物を持った後から」「温めると少し楽」「食後に悪化」）
- associated: 随伴症状（主訴に伴う他の症状。例:「吐き気、めまい、悪寒あり」）
- medication: 服用中・使用中の薬や対処（市販薬・処方薬・湿布など。例:「降圧薬を毎朝1錠。市販の解熱剤を昨日1回服用」）
- allergy: アレルギー（薬・食物など。例:「甲殻類（エビ・カニ）」「特になし」）
- history: 既往歴・通院歴・基礎疾患（言及があれば。例:「高血圧で通院中」）
- concern: 患者が医師に伝えたいこと・不安・受診理由（例:「がんではないか心配」「いつ受診すべきか知りたい」）
- other: 上記に当てはまらない補足情報

【禁止事項】
- 診断名の断定、治療・薬の提案、検査の指示はしない。
- 患者が話していない情報を推測で補わない。`;

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
    { key: 'course', label: '経過', icon: '📈', value: memo.course, highlight: false },
    { key: 'quality', label: '症状の性質・部位', icon: '🔍', value: memo.quality, highlight: false },
    { key: 'severity', label: 'つらさ・生活への影響', icon: '🌡️', value: memo.severity, highlight: false },
    { key: 'trigger', label: 'きっかけ・誘因', icon: '🔥', value: memo.trigger, highlight: false },
    { key: 'associated', label: '随伴症状', icon: '➕', value: memo.associated, highlight: false },
    { key: 'medication', label: '服薬', icon: '💊', value: memo.medication, highlight: true },
    { key: 'allergy', label: 'アレルギー', icon: '⚠️', value: memo.allergy, highlight: true },
    { key: 'history', label: '既往・通院歴', icon: '🏥', value: memo.history, highlight: false },
    { key: 'concern', label: '伝えたいこと・不安', icon: '💬', value: memo.concern, highlight: false },
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

  const fields = [
    ['主訴', memo.chiefComplaint],
    ['発症', memo.onset],
    ['経過', memo.course],
    ['症状の性質・部位', memo.quality],
    ['つらさ・生活への影響', memo.severity],
    ['きっかけ・誘因', memo.trigger],
    ['随伴症状', memo.associated],
    ['服薬', memo.medication],
    ['アレルギー', memo.allergy],
    ['既往・通院歴', memo.history],
    ['伝えたいこと・不安', memo.concern],
    ['その他', memo.other],
  ];

  const isBlank = (v) => !v || ['不明', '特になし', 'なし', '聞き取れず'].includes(String(v).trim());
  const lines = fields
    .filter(([, v]) => !isBlank(v))
    .map(([label, v]) => `・${label}: ${v}`);

  return `【AI事前問診メモ】
作成日時: ${dateStr}

${lines.join('\n')}

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
