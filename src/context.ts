import { readContextFromAdo, RepoContext } from './ado-reader';

// ─── CONTEXT LOADER ───────────────────────────────────────────────────────────

export async function loadContext(repoName: string): Promise<RepoContext> {
  const ADO_ORG_URL = process.env.ADO_ORG_URL  ?? '';
  const ADO_PAT     = process.env.ADO_PAT      ?? '';
  const ADO_PROJECT = process.env.ADO_PROJECT  ?? '';

  if (!ADO_ORG_URL || !ADO_PAT) {
    console.error('[context] ERROR: ADO_ORG_URL y ADO_PAT son requeridos.');
    return { readme: '', files: [], structureSummary: '', source: 'ado' };
  }

  try {
    return await readContextFromAdo(ADO_ORG_URL, ADO_PAT, ADO_PROJECT, repoName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[context][${repoName}] Error leyendo desde ADO:\n${msg}`);
    return { readme: '', files: [], structureSummary: '', source: 'ado' };
  }
}

// ─── SYSTEM PROMPT (completo — para chat) ────────────────────────────────────

export function buildSystemPrompt(ctx: RepoContext, extraContext = ''): string {
  const fileSections = ctx.files
    .map(f => `--- ${f.path} ---\n${f.content}`)
    .join('\n\n');

  const sections = [
    ctx.readme           && `═══ DESCRIPCIÓN DEL MÓDULO (README) ═══\n${ctx.readme}`,
    ctx.structureSummary && `═══ ESTRUCTURA DEL PROYECTO ═══\n${ctx.structureSummary}`,
    fileSections         && `═══ ARCHIVOS DEL PROYECTO (.html y .ts) ═══\n\n${fileSections}`,
    extraContext         && `═══ INFORMACIÓN ADICIONAL DE PRODUCTO ═══\n${extraContext}`,
  ].filter(Boolean).join('\n\n');

  return `Eres un asistente virtual de ayuda para los modulos del portal de clientes de Skandia Colombia.
Tu propósito es ayudar a los clientes a entender y usar dichos módulos.
El contexto fue escaneado directamente desde el repositorio en Azure DevOps.

${sections || 'Módulo Angular de gestión de portafolios de Skandia Colombia.'}

═══ INSTRUCCIONES DE COMPORTAMIENTO ═══
- Responde SIEMPRE en español colombiano, tono cálido y profesional
- Máximo 3 párrafos cortos por respuesta
- Usa lenguaje financiero simple, accesible para cualquier cliente
- Si preguntan sobre un flujo visual, sugiere el tour interactivo
- Si no tienes información suficiente, recomienda llamar a la línea Skandia
- NUNCA menciones código, componentes técnicos ni lenguaje de programación
- Solo responde preguntas sobre el modulo solicitado
- Cuando sugieras el tour escribe: "💡 Puedes ver esto en acción con el **Tour interactivo**"`;
}

// ─── SYSTEM PROMPT CORTO (para generación de FAQ) ────────────────────────────
// Solo README + archivos que contengan términos de ayuda/negocio relevantes.
// Máx ~8K chars para no exceder el límite del modelo.

const FAQ_BUDGET = 8_000;

// Palabras clave en el PATH del archivo (selección de archivos)
const PATH_KEYWORDS  = ['constant', 'help', 'hep', 'faq', 'ayuda'];

// Palabras clave en el CONTENIDO del archivo (relevancia de negocio)
const CONTENT_KEYWORDS = [
  'pregunta', 'respuesta', 'answer', 'question', 'help',
  'gestión', 'portafolio', 'inversión', 'perfil', 'contrato',
  'redistribuir', 'invested', 'parcial', 'stepper', 'tour',
];

export function buildShortSystemPrompt(ctx: RepoContext, extraContext = ''): string {
  // 1. Archivos de constantes/ayuda (por nombre de archivo)
  const byPath = ctx.files.filter(f =>
    PATH_KEYWORDS.some(k => f.path.toLowerCase().includes(k)),
  );

  // 2. Archivos con contenido de negocio relevante (por contenido)
  const byContent = ctx.files.filter(f =>
    !PATH_KEYWORDS.some(k => f.path.toLowerCase().includes(k)) &&
    CONTENT_KEYWORDS.some(k => f.content.toLowerCase().includes(k)),
  );

  const fileSections: string[] = [];
  let budget = FAQ_BUDGET - Math.min(ctx.readme.length, 2_000);

  for (const f of [...byPath, ...byContent]) {
    const section = `--- ${f.path} ---\n${f.content}`;
    if (budget - section.length < 0) break;
    fileSections.push(section);
    budget -= section.length;
  }

  const readmeSnippet = ctx.readme.substring(0, 2_000);

  const sections = [
    readmeSnippet       && `═══ README ═══\n${readmeSnippet}`,
    fileSections.length && `═══ ARCHIVOS RELEVANTES ═══\n\n${fileSections.join('\n\n')}`,
    extraContext        && `═══ INFORMACIÓN ADICIONAL DE PRODUCTO ═══\n${extraContext}`,
  ].filter(Boolean).join('\n\n');

  console.log(`[context] Short prompt: ${byPath.length} por nombre + ${fileSections.length - byPath.length} por contenido`);

  return `Contexto del módulo Angular de Skandia Colombia escaneado desde Azure DevOps:\n\n${sections}`;
}
