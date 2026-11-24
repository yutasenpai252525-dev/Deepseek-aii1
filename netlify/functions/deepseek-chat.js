exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const requestedModel = body.model || '';
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.75;
    const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 1000;

    if (!messages.length) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'messages array is required' })
      };
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'DEEPSEEK_API_KEY is not configured in environment variables' })
      };
    }

    const endpoints = [
      {
        url: process.env.DEEPSEEK_BASE_URL || 'https://api.aimlapi.com/v1/chat/completions',
        models: requestedModel
          ? [requestedModel, 'deepseek/deepseek-chat', 'deepseek-chat']
          : ['deepseek/deepseek-chat', 'deepseek-chat', 'deepseek-reasoner']
      },
      {
        url: 'https://api.deepseek.com/chat/completions',
        models: ['deepseek-chat', 'deepseek-reasoner']
      }
    ];

    let lastStatus = 502;
    let lastErrorText = 'Upstream request failed';

    for (const ep of endpoints) {
      for (const mdl of ep.models) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 14000);

          const resp = await fetch(ep.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: mdl,
              messages,
              temperature,
              max_tokens: maxTokens
            }),
            signal: controller.signal
          });

          clearTimeout(timer);
          lastStatus = resp.status;

          if (!resp.ok) {
            lastErrorText = await resp.text();
            continue;
          }

          const data = await resp.json();
          const content =
            data?.choices?.[0]?.message?.content ||
            data?.choices?.[0]?.text ||
            '';

          if (content && String(content).trim().length > 0) {
            return {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              },
              body: JSON.stringify({
                reply: String(content).trim(),
                model: mdl,
                source: ep.url
              })
            };
          }
        } catch (err) {
          lastErrorText = err && err.message ? err.message : 'Fetch error';
        }
      }
    }

    return {
      statusCode: lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'All DeepSeek upstream attempts failed',
        detail: String(lastErrorText).slice(0, 300)
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message || 'Internal server error' })
    };
  }
};
