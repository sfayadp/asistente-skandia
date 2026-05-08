import * as azdev from 'azure-devops-node-api';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { GitRepository } from 'azure-devops-node-api/interfaces/GitInterfaces';

export interface RepoContext {
  readme:           string;
  files:            Array<{ path: string; content: string }>;
  structureSummary: string;
  source:           'ado';
}

const README_LIMIT   = 4_000;   // caracteres máximos del README
const FILE_LIMIT     = 3_000;   // caracteres máximos por archivo .html / .ts
const TOTAL_BUDGET   = 70_000;  // presupuesto total de contexto
const MAX_FILES      = 100;      // archivos máximos a leer

export async function readContextFromAdo(
  orgUrl: string,
  pat: string,
  project: string,
  repoName: string,
): Promise<RepoContext> {
  const authHandler = azdev.getPersonalAccessTokenHandler(pat);
  const connection  = new azdev.WebApi(orgUrl, authHandler);
  const git: IGitApi = await connection.getGitApi();

  const repo = await findRepo(git, repoName, project);

  const repoId   = repo.id!;
  const repoProj = repo.project?.name ?? project;
  const branch   = repo.defaultBranch?.replace('refs/heads/', '') ?? 'main';

  console.log(`[ado-reader] Repo: "${repo.name}" | Proyecto: "${repoProj}" | Rama: ${branch}`);

  const versionDescriptor = { version: branch, versionType: 0 } as any;

  async function readFile(filePath: string, limit: number): Promise<string> {
    try {
      const stream = await git.getItemContent(
        repoId, filePath, repoProj,
        undefined, undefined, undefined, undefined, undefined,
        versionDescriptor,
      );
      if (!stream) return '';
      return (await streamToString(stream)).substring(0, limit);
    } catch {
      return '';
    }
  }

  // ── 1. README ────────────────────────────────────────────────────────────────
  const readme = await readFile('/README.md', README_LIMIT);

  // ── 2. Listar todos los archivos de /src recursivamente ───────────────────
  const allItems = await git.getItems(
    repoId, repoProj, '/src',
    120 as any,  // VersionControlRecursionType.Full
    undefined, undefined, undefined, undefined,
    versionDescriptor,
  );

  // ── 3. Filtrar solo .html y .ts (sin .spec.ts) ────────────────────────────
  const targetPaths = (allItems ?? [])
    .filter(i => !i.isFolder && i.path)
    .filter(i => {
      const p = i.path!;
      return (p.endsWith('.html') || p.endsWith('.ts')) && !p.endsWith('.spec.ts');
    })
    .map(i => i.path!)
    .slice(0, MAX_FILES);

  console.log(`[ado-reader] Archivos .html/.ts encontrados: ${targetPaths.length} — leyendo...`);

  // ── 4. Leer en paralelo ───────────────────────────────────────────────────
  const contents = await Promise.all(targetPaths.map(p => readFile(p, FILE_LIMIT)));

  // ── 5. Aplicar presupuesto total ──────────────────────────────────────────
  const files: Array<{ path: string; content: string }> = [];
  let totalChars = readme.length;

  for (let i = 0; i < targetPaths.length; i++) {
    const c = contents[i];
    if (!c) continue;
    if (totalChars + c.length > TOTAL_BUDGET) break;
    files.push({ path: targetPaths[i], content: c });
    totalChars += c.length;
  }

  // ── 6. Resumen de estructura ──────────────────────────────────────────────
  const structureSummary = await readDirectoryStructure(git, repoId, repoProj, versionDescriptor);

  console.log(`[ado-reader] Contexto listo — readme: ${readme.length}c | archivos: ${files.length} | total: ${totalChars}c`);

  return { readme, files, structureSummary, source: 'ado' };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function findRepo(git: IGitApi, repoName: string, project: string): Promise<GitRepository> {
  const nameLower = repoName.toLowerCase();

  try {
    const projectRepos = await git.getRepositories(project);
    const found = projectRepos?.find(r => r.name?.toLowerCase() === nameLower);
    if (found?.id) return found;
  } catch { /* sigue buscando */ }

  console.warn(`[ado-reader] No encontrado en proyecto "${project}", buscando en toda la organización...`);
  const allRepos = await git.getRepositories();

  if (!allRepos?.length) {
    throw new Error('No se encontraron repositorios. Verifica ADO_ORG_URL y ADO_PAT.');
  }

  const found = allRepos.find(r => r.name?.toLowerCase() === nameLower);
  if (found?.id) {
    console.log(`[ado-reader] Encontrado en proyecto: "${found.project?.name}"`);
    return found;
  }

  const available = allRepos.map(r => `  • ${r.project?.name} / ${r.name}`).join('\n');
  throw new Error(
    `Repositorio "${repoName}" no encontrado.\nDisponibles:\n${available}\n\nRevisa ADO_PROJECT y ADO_REPO en tu .env`,
  );
}

async function readDirectoryStructure(
  git: IGitApi,
  repoId: string,
  project: string,
  versionDescriptor: any,
): Promise<string> {
  try {
    const items = await git.getItems(repoId, project, '/src/app', 1 as any, undefined, undefined, undefined, undefined, versionDescriptor);
    if (!items?.length) return '';
    return items
      .filter(i => i.path && i.path !== '/src/app')
      .map(i => `${i.isFolder ? '📁' : '📄'} ${i.path}`)
      .slice(0, 60)
      .join('\n');
  } catch {
    return '';
  }
}

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    stream.on('end',   () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}
