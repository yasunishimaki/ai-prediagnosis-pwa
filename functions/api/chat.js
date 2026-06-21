// ============================================
// Cloudflare Pages Function: POST /api/chat
// 患者アプリ（同一ドメイン）→ ここ（サーバー側）→ OpenAI Chat Completions へ中継する。
// OPENAI_API_KEY は Pages の環境変数(Secret)に保存し、クライアントには一切出さない。
// アプリと同一オリジンから呼ばれるため、CORS 設定は不要。
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
    const bodyText = await request.text();
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: bodyText,
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
