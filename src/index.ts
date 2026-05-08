import express, { Request, Response } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { loadContext, buildSystemPrompt, buildShortSystemPrompt } from './context';
import { fetchUrlsContent } from './url-reader';
import { chat, ChatMessage } from './chat';
import { generateRepoHelp, generateTourSlides, RepoHelp, TourData } from './generate';

dotenv.config();

if (!process.env.AZURE_AI_ENDPOINT || !process.env.AZURE_AI_KEY) {
  console.error('[tutorial-api] ERROR: AZURE_AI_ENDPOINT y AZURE_AI_KEY deben estar configuradas');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:4200').split(',');

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50kb' }));

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function parseUrls(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.split(',');
  return list.map(u => u.trim()).filter(Boolean);
}

function contextKey(repo: string, urls: string[]): string {
  return urls.length ? `${repo}||${[...urls].sort().join('|')}` : repo;
}

// ─── URL CONTENT CACHE ────────────────────────────────────────────────────────
// Una entrada por URL individual — reutilizable en múltiples repos/combinaciones.

const urlCache = new Map<string, Promise<string>>();

function getCachedUrl(url: string): Promise<string> {
  if (!urlCache.has(url)) {
    urlCache.set(url, fetchUrlsContent([url]));
  }
  return urlCache.get(url)!;
}

async function getUrlsContent(urls: string[]): Promise<string> {
  if (!urls.length) return '';
  const parts = await Promise.all(urls.map(getCachedUrl));
  return parts.filter(Boolean).join('\n\n');
}

// ─── CONTEXT CACHE ────────────────────────────────────────────────────────────
// Contexto del repo (system prompt) — cargado desde ADO la primera vez por repo.

// Guarda tanto el prompt completo (chat) como el corto (FAQ generation)
const ctxCache = new Map<string, Promise<{ full: string; short: string }>>();

function getContext(repoName: string, urls: string[] = []): Promise<{ full: string; short: string }> {
  const key = contextKey(repoName, urls);
  if (!ctxCache.has(key)) {
    console.log(`[context-cache] Cargando contexto para: ${repoName}${urls.length ? ` + ${urls.length} URL(s)` : ''}`);
    const promise = Promise.all([loadContext(repoName), getUrlsContent(urls)]).then(([ctx, extra]) => {
      const full  = buildSystemPrompt(ctx, extra);
      const short = buildShortSystemPrompt(ctx, extra);
      console.log(`[context-cache] ✓ ${key} — ${ctx.files.length} archivos | extra: ${extra.length}c | chat: ${full.length}c | faq: ${short.length}c`);
      return { full, short };
    });
    ctxCache.set(key, promise);
  }
  return ctxCache.get(key)!;
}

// ─── HELP CACHE ───────────────────────────────────────────────────────────────

const helpCache = new Map<string, Promise<RepoHelp>>();

function getRepoHelp(repoName: string, urls: string[] = []): Promise<RepoHelp> {
  const key = contextKey(repoName, urls);
  if (!helpCache.has(key)) {
    console.log(`[help-cache] Generando FAQ/sugerencias para: ${key}`);
    const promise = getContext(repoName, urls).then(({ short }) => generateRepoHelp(short));
    helpCache.set(key, promise);
  }
  return helpCache.get(key)!;
}

// ─── TOUR CACHE ───────────────────────────────────────────────────────────────

const tourCache = new Map<string, Promise<TourData>>();

function getTourData(repoName: string, urls: string[] = []): Promise<TourData> {
  const key = contextKey(repoName, urls);
  if (!tourCache.has(key)) {
    console.log(`[tour-cache] Generando slides de tour para: ${key}`);
    const promise = getContext(repoName, urls).then(({ short }) => generateTourSlides(short));
    tourCache.set(key, promise);
  }
  return tourCache.get(key)!;
}

// ─── STARTUP: pre-calentar repos conocidos ────────────────────────────────────

const DEFAULT_REPOS = (process.env.ADO_REPOS ?? process.env.ADO_REPO ?? '')
  .split(',')
  .map(r => r.trim())
  .filter(Boolean);

if (DEFAULT_REPOS.length) {
  console.log(`[tutorial-api] Pre-calentando: ${DEFAULT_REPOS.join(', ')}`);
  DEFAULT_REPOS.forEach(repo => getRepoHelp(repo));
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', cachedRepos: [...ctxCache.keys()] });
});

// Devuelve FAQ y sugerencias generadas dinámicamente desde el repo escaneado
app.get('/repo-context', async (req: Request, res: Response) => {
  const repo = (req.query['repo'] as string)?.trim();
  const urls = parseUrls(req.query['urls'] as string | string[]);

  if (!repo) {
    res.status(400).json({ error: 'El parámetro "repo" es requerido' });
    return;
  }

  try {
    const help = await getRepoHelp(repo, urls);
    res.json(help);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tutorial-api][${repo}] Error en /repo-context:`, msg);
    res.status(500).json({ error: 'No se pudo generar el contexto del repo' });
  }
});

// Devuelve slides de tour generados dinámicamente desde el repo escaneado
app.get('/tour', async (req: Request, res: Response) => {
  const repo = (req.query['repo'] as string)?.trim();
  const urls = parseUrls(req.query['urls'] as string | string[]);

  if (!repo) {
    res.status(400).json({ error: 'El parámetro "repo" es requerido' });
    return;
  }

  try {
    const tour = await getTourData(repo, urls);
    res.json(tour);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tutorial-api][${repo}] Error en /tour:`, msg);
    res.status(500).json({ error: 'No se pudo generar el tour del repo' });
  }
});

// Responde preguntas del chat usando el contexto del repo indicado
app.post('/chat', async (req: Request, res: Response) => {
  const { message, history, repo, urls: rawUrls } = req.body as {
    message: string;
    history?: ChatMessage[];
    repo?: string;
    urls?: string[];
  };

  if (!message?.trim()) {
    res.status(400).json({ error: 'El campo "message" es requerido' });
    return;
  }

  if (!repo?.trim()) {
    res.status(400).json({ error: 'El campo "repo" es requerido' });
    return;
  }

  const urls = parseUrls(rawUrls);

  try {
    const { full: systemPrompt } = await getContext(repo.trim(), urls);
    const answer = await chat(message.trim(), history ?? [], systemPrompt);
    res.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tutorial-api][${repo}] Error en /chat:`, msg);
    res.status(500).json({
      error: 'No pude procesar tu pregunta en este momento. Por favor intenta de nuevo.',
    });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[tutorial-api] Servidor corriendo en http://localhost:${PORT}`);
});
