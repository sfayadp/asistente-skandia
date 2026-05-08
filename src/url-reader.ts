import * as https from 'https';
import * as http from 'http';

const MAX_CHARS_PER_URL = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

function fetchRaw(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tutorial-api/1.0; +https://skandia.co)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CO,es;q=0.9',
      },
    }, res => {
      // Follow single redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchRaw(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} al obtener ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Timeout al obtener ${url}`));
    });
    req.on('error', reject);
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function fetchUrlText(url: string): Promise<string> {
  const html = await fetchRaw(url);
  const text = htmlToText(html);
  return text.substring(0, MAX_CHARS_PER_URL);
}

export async function fetchUrlsContent(urls: string[]): Promise<string> {
  if (!urls.length) return '';

  const results = await Promise.allSettled(
    urls.map(async url => {
      console.log(`[url-reader] Fetching: ${url}`);
      const text = await fetchUrlText(url);
      console.log(`[url-reader] ✓ ${url} — ${text.length} chars`);
      return { url, text };
    }),
  );

  const parts: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      parts.push(`--- ${result.value.url} ---\n${result.value.text}`);
    } else {
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[url-reader] ✗ Error fetching URL: ${err}`);
    }
  }

  return parts.join('\n\n');
}
