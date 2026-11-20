const targets = [
  { label: 'Worker', url: 'https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?url=https%3A%2F%2Fexample.com' },
  { label: 'JinaReader', url: 'https://r.jina.ai/https://example.com' },
  { label: 'JinaReader-Article', url: 'https://r.jina.ai/https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS' },
  { label: 'JinaReader-Note', url: 'https://r.jina.ai/https://note.com/' },
  { label: 'JinaReader-NoteArticle', url: 'https://r.jina.ai/https://note.com/norinity1103/n/n6c5e0426eb7b' },
  { label: 'NotePublicArticleAPI', url: 'https://note.com/api/v3/notes/n6c5e0426eb7b' },
  { label: 'JinaReader-X', url: 'https://r.jina.ai/https://x.com/YouTube' }
];
for (const target of targets) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(target.url, {
      headers: { 'Origin': 'https://silovar-uk.github.io', 'Accept': 'text/plain,application/json;q=0.9' },
      signal: controller.signal
    });
    const whole = await response.text();
    const body = whole.slice(0, 700);
    const cors = response.headers.get('access-control-allow-origin');
    const corsUsable = cors === '*' || cors === 'https://silovar-uk.github.io';
    console.log(JSON.stringify({ service: target.label, status: response.status, cors, corsUsable, contentType: response.headers.get('content-type'), sample: body }));
    if (target.label === 'JinaReader-X') {
      const match = whole.match(/https:\/\/x\.com\/YouTube\/status\/([0-9]{15,20})/i);
      if (match) {
        const post = await fetch('https://r.jina.ai/https://x.com/YouTube/status/' + match[1], {
          headers: { 'Origin': 'https://silovar-uk.github.io', 'Accept': 'text/plain' },
          signal: controller.signal
        });
        const sample = (await post.text()).slice(0, 1100);
        console.log(JSON.stringify({ service: 'JinaReader-X-Post', status: post.status, cors: post.headers.get('access-control-allow-origin'), sample }));
      }
    }
  } catch (e) {
    console.log(JSON.stringify({service: target.label, error: String(e)}));
  } finally { clearTimeout(t); }
}
