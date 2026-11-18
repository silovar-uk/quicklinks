const targets = [
  { label: 'Worker', url: 'https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?url=https%3A%2F%2Fexample.com' },
  { label: 'JinaReader', url: 'https://r.jina.ai/https://example.com' }
];
for (const target of targets) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(target.url, {
      headers: { 'Origin': 'https://silovar-uk.github.io', 'Accept': 'text/plain,application/json;q=0.9' },
      signal: controller.signal
    });
    const body = (await response.text()).slice(0, 700);
    const cors = response.headers.get('access-control-allow-origin');
    const corsUsable = cors === '*' || cors === 'https://silovar-uk.github.io';
    console.log(JSON.stringify({ service: target.label, status: response.status, cors, corsUsable, contentType: response.headers.get('content-type'), sample: body }));
  } catch (e) {
    console.log(JSON.stringify({service: target.label, error: String(e)}));
  } finally { clearTimeout(t); }
}
