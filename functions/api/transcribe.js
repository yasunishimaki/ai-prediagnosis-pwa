// ============================================
// Cloudflare Pages Function: POST /api/transcribe
// 患者アプリ（同一ドメイン）→ ここ（サーバー側）→ OpenAI Whisper へ中継する。
// OPENAI_API_KEY は Pages の環境変数(Secret)に保存し、クライアントには一切出さない。
// アプリと同一オリジンから呼ばれるため、CORS 設定は不要。
//
// Pages の環境変数:
//   OPENAI_API_KEY … 必須（暗号化して保存）
//   APP_TOKEN      … 任意（合言葉。設定すると x-app-token ヘッダー必須に）
// ============================================
export async function onRequestPost({ request, env }) {
  // 簡易アクセス制御（合言葉）。APP_TOKEN 未設定なら無効。
  if (env.APP_TOKEN && request.headers.get('x-app-token') !== env.APP_TOKEN) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'Server is not configured (OPENAI_API_KEY missing)' }, 500);
  }

  try {
    // multipart をそのまま中継（boundary 付きの Content-Type を保持する）
    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': request.headers.get('Content-Type') || 'multipart/form-data',
      },
      body: request.body,
    });
    return passthrough(upstream);
  } catch (err) {
    return json({ error: 'Proxy error', detail: String(err) }, 502);
  }
}

function passthrough(upstream) {
  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  return new Response(upstream.body, { status: upstream.status, headers });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
