import { chat } from './chat';

export interface TourStep {
  element?:    string | null;
  title:       string;
  description: string;
}

export interface TourSection {
  page:  string;
  label: string;
  steps: TourStep[];
}

export interface TourData {
  sections: TourSection[];
}

export interface HelpQuestion {
  id:       number;
  question: string;
  answer:   string;
}

export interface RepoHelp {
  faqQuestions: HelpQuestion[];
  suggestions:  string[];
}

const GENERATION_PROMPT = `
Analiza el contexto del proyecto y genera contenido de ayuda para los clientes de este módulo.

Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto adicional) con este formato exacto:
{
  "faqQuestions": [
    { "id": 1, "question": "pregunta que haría un cliente", "answer": "respuesta clara en español colombiano" },
    { "id": 2, "question": "...", "answer": "..." },
    { "id": 3, "question": "...", "answer": "..." },
    { "id": 4, "question": "...", "answer": "..." }
  ],
  "suggestions": [
    "Pregunta corta 1 (máx 7 palabras)",
    "Pregunta corta 2",
    "Pregunta corta 3",
    "Pregunta corta 4"
  ]
}

Reglas:
- Las preguntas deben ser reales, basadas en las funcionalidades del módulo escaneado
- Las respuestas deben ser claras, en español colombiano, sin mencionar código ni componentes técnicos
- Las sugerencias son preguntas muy cortas para inspirar al usuario en el chat
`.trim();

const TOUR_PROMPT = `
Analiza los archivos HTML del proyecto e identifica las diferentes páginas o secciones del módulo.

Busca patrones como "@switch (currentStepIndex())", "@case (0)", "@case (1)", steppers o wizards para identificar las páginas.
Si no hay stepper (módulo de una sola vista), genera una sola sección con page "0".

Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto adicional) con este formato exacto:
{
  "sections": [
    {
      "page": "0",
      "label": "Nombre descriptivo de esta página",
      "steps": [
        { "element": "selector-css-real-o-null", "title": "Título del paso", "description": "Descripción en 1-2 oraciones." }
      ]
    },
    {
      "page": "1",
      "label": "...",
      "steps": [...]
    }
  ]
}

Reglas para "element" en cada paso:
- Usa selectores CSS que EXISTAN en los archivos HTML de ESA página/sección específica
- Selectores de componentes Angular son válidos: "stepper", "help-menu", "porfolio-cards", "investment-card", "current-composition", "portfolio-composition-manager", etc.
- Clases CSS válidas si aparecen en el HTML: ".portfolio-user", ".search-composition", ".profile-user"
- Si no hay selector relevante, usa null

Reglas de contenido:
- 3 a 5 pasos por sección, cubriendo las funcionalidades clave de esa página
- Título máximo 6 palabras, directo y claro
- Descripción en español colombiano, cálido, sin tecnicismos, máximo 2 oraciones
`.trim();

export async function generateTourSlides(shortSystemPrompt: string): Promise<TourData> {
  console.log(`[generate] Generando slides de tour (${shortSystemPrompt.length} chars)...`);
  const raw = await chat(TOUR_PROMPT, [], shortSystemPrompt, 2048);
  console.log(`[generate] Slides recibidos (${raw.length} chars)`);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Respuesta no contiene JSON: ${raw.substring(0, 300)}`);
  const parsed = JSON.parse(match[0]) as TourData;
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error(`JSON con estructura inesperada: ${JSON.stringify(parsed).substring(0, 200)}`);
  }
  const totalSteps = parsed.sections.reduce((n, s) => n + s.steps.length, 0);
  console.log(`[generate] Tour generado: ${parsed.sections.length} secciones, ${totalSteps} pasos`);
  return parsed;
}

export async function generateRepoHelp(shortSystemPrompt: string): Promise<RepoHelp> {
  console.log(`[generate] Llamando al modelo (${shortSystemPrompt.length} chars de contexto)...`);

  const raw = await chat(GENERATION_PROMPT, [], shortSystemPrompt, 2048);

  console.log(`[generate] Respuesta recibida (${raw.length} chars)`);

  // Extraer JSON aunque el modelo añada markdown o texto extra
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Respuesta no contiene JSON: ${raw.substring(0, 300)}`);

  const parsed = JSON.parse(match[0]) as RepoHelp;

  if (!Array.isArray(parsed.faqQuestions) || !Array.isArray(parsed.suggestions)) {
    throw new Error(`JSON con estructura inesperada: ${JSON.stringify(parsed).substring(0, 200)}`);
  }

  console.log(`[generate] FAQ generada: ${parsed.faqQuestions.length} preguntas, ${parsed.suggestions.length} sugerencias`);

  return parsed;
}
