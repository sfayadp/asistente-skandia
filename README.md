# tutorial-api

API backend del asistente de ayuda inteligente para módulos Angular de Skandia Colombia.

Escanea automáticamente el código fuente de un repositorio en Azure DevOps y usa Azure AI para generar contenido de ayuda contextual: preguntas frecuentes, sugerencias de chat, tour guiado por páginas y respuestas conversacionales.

---

## Cómo funciona

```
Repositorio ADO  ──┐
   (.html / .ts)   ├──►  Escáner / Fetcher  ──►  Azure AI (GPT)  ──►  Endpoints REST
URLs externas   ──┘         (contexto)            Responses API         FAQ / Tour / Chat
```

1. Al recibir la primera petición para un `repo`, la API lee todos los archivos `.html` y `.ts` del repositorio en ADO (hasta ~70 KB de contexto).
2. Si se pasan `urls`, las descarga, extrae el texto visible (strip HTML) y lo añade al contexto como sección adicional.
3. Con ese contexto construye dos prompts: uno completo (para chat) y uno filtrado ~8 KB (para generación de FAQ y tour).
4. El modelo genera el contenido y lo guarda en caché en memoria. Las peticiones siguientes responden al instante.

---

## Requisitos

- Node.js 20+
- Acceso a un deployment de Azure AI (modelo compatible con la Responses API)
- Personal Access Token de Azure DevOps con permisos de lectura en el repositorio

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Azure AI (Responses API)
AZURE_AI_ENDPOINT=https://<tu-recurso>.cognitiveservices.azure.com/
AZURE_AI_KEY=<tu-api-key>
AZURE_AI_MODEL=<nombre-del-deployment>        # ej: gpt-4o-mini
AZURE_AI_API_VERSION=2025-04-01-preview       # opcional, este es el default

# Azure DevOps
ADO_ORG_URL=https://dev.azure.com/<tu-org>
ADO_PAT=<tu-personal-access-token>
ADO_PROJECT=<nombre-del-proyecto>             # opcional, mejora la búsqueda

# Servidor
PORT=3001                                      # opcional, default 3001
ALLOWED_ORIGINS=http://localhost:4200          # orígenes CORS permitidos (coma-separados)

# Pre-calentamiento al arrancar (opcional)
ADO_REPOS=SkCo.PortfolioManagement.Angular,SkCo.ProfileModule.Angular
```

> **Nota sobre el endpoint:** la API extrae automáticamente el origen base (`scheme + host`) para construir la URL correcta. Puedes pegar la URL completa del recurso o solo el origen.

---

## Instalación y ejecución

```bash
npm install

# Desarrollo (recarga automática)
npm run dev

# Producción
npm run build
npm start
```

---

## Endpoints

### `GET /health`
Verifica que el servidor está activo y muestra los repos que tienen contexto cargado.

```json
{ "status": "ok", "cachedRepos": ["SkCo.PortfolioManagement.Angular"] }
```

---

### `GET /repo-context?repo=<nombre>&urls=<url1,url2>`
Devuelve las preguntas frecuentes y sugerencias de chat generadas por IA a partir del código del repositorio y, opcionalmente, del contenido de URLs externas.

**Parámetros**
| Parámetro | Tipo   | Requerido | Descripción                                                    |
|-----------|--------|-----------|----------------------------------------------------------------|
| `repo`    | string | Sí        | Nombre exacto del repositorio en ADO                          |
| `urls`    | string | No        | URLs separadas por coma para enriquecer el contexto           |

**Respuesta**
```json
{
  "faqQuestions": [
    { "id": 1, "question": "¿Cómo redistribuyo mis portafolios?", "answer": "Para redistribuir..." },
    { "id": 2, "question": "...", "answer": "..." }
  ],
  "suggestions": [
    "¿Cómo cambio mi perfil?",
    "¿Qué es un portafolio conservador?",
    "¿Cuándo se procesa mi gestión?",
    "¿Puedo cancelar una operación?"
  ]
}
```

---

### `GET /tour?repo=<nombre>&urls=<url1,url2>`
Devuelve el tour guiado por páginas generado por IA. El contenido está organizado en secciones, una por cada paso/página del módulo (detectado a partir de los `@switch`/`@case` del stepper en el HTML).

**Parámetros**
| Parámetro | Tipo   | Requerido | Descripción                                                    |
|-----------|--------|-----------|----------------------------------------------------------------|
| `repo`    | string | Sí        | Nombre exacto del repositorio en ADO                          |
| `urls`    | string | No        | URLs separadas por coma para enriquecer el contexto           |

**Respuesta**
```json
{
  "sections": [
    {
      "page": "0",
      "label": "Selección de portafolios",
      "steps": [
        { "element": "porfolio-cards", "title": "Elige tu modalidad", "description": "Aquí decides cómo invertir..." },
        { "element": "help-menu",      "title": "Centro de ayuda",    "description": "Encuentra respuestas rápidas..." },
        { "element": null,             "title": "Tu perfil de riesgo","description": "Tu perfil determina..." }
      ]
    },
    {
      "page": "1",
      "label": "Gestión del contrato",
      "steps": [
        { "element": "portfolio-composition-manager", "title": "Distribuye tus fondos", "description": "Aquí ajustas..." }
      ]
    },
    {
      "page": "2",
      "label": "Resumen de la gestión",
      "steps": [
        { "element": "portfolio-management-summary", "title": "Confirma tu gestión", "description": "Revisa los cambios..." }
      ]
    }
  ]
}
```

> Los `element` son selectores CSS reales identificados en el HTML del repo (etiquetas de componentes Angular o clases CSS). Si el elemento no existe en el DOM al momento de ejecutar el tour, el paso se muestra como popover flotante centrado.

---

### `POST /chat`
Responde una pregunta del usuario usando el contexto completo del repositorio como system prompt.

**Body**
```json
{
  "message": "¿Cómo redistribuyo mis portafolios?",
  "repo": "SkCo.PortfolioManagement.Angular",
  "history": [
    { "role": "user",      "content": "mensaje anterior" },
    { "role": "assistant", "content": "respuesta anterior" }
  ],
  "urls": ["https://www.skandia.co/portafolios-fondo-voluntario-de-pension-skandia"]
}
```

> `urls` es opcional. Cuando se incluye, el contexto de las URLs se añade al system prompt del chat.

**Respuesta**
```json
{ "answer": "Para redistribuir tus portafolios..." }
```

> `history` es opcional. Se toman los últimos 10 mensajes para mantener el contexto de la conversación.

---

## Caché en memoria

Todas las operaciones costosas (escaneo ADO + fetch de URLs + generación IA) se cachean en memoria:

| Caché         | Qué guarda                                    | Llave de caché          | Se invalida  |
|---------------|-----------------------------------------------|-------------------------|--------------|
| `urlCache`    | Texto extraído de cada URL                    | URL individual          | Al reiniciar |
| `ctxCache`    | System prompts (completo y corto)             | `repo` + `urls` sorted  | Al reiniciar |
| `helpCache`   | FAQ + sugerencias generadas                   | `repo` + `urls` sorted  | Al reiniciar |
| `tourCache`   | Tour por secciones generado                   | `repo` + `urls` sorted  | Al reiniciar |

Si el mismo `repo` se consulta con distintas combinaciones de `urls`, cada combinación tiene su propia entrada de caché.

Para regenerar el contenido (tras cambios en el repo o en las URLs), **reinicia el servidor**.

---

## Integración en Angular

### 1. Instalar dependencias

El front no requiere dependencias adicionales. La integración se hace mediante `HttpClient` nativo de Angular.

En el proyecto que usará el asistente, asegúrate de tener `driver.js` instalado (para el tour guiado):

```bash
npm install driver.js
```

### 2. Variable de entorno

Agrega `tutorialApiUrl` a cada archivo de entorno del proyecto Angular:

```typescript
// environment.ts / environment.dev.ts / environment.stg.ts / environment.prd.ts
export const environment = {
  // ...resto de variables
  tutorialApiUrl: 'http://localhost:3001',   // dev
  // tutorialApiUrl: 'https://tutorial-api.tudominio.com',  // producción
};
```

### 3. Servicio Angular

Crea `src/app/core/service/tutorial-ai/tutorial-ai.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '@envs/environment';

export interface ChatMessage  { role: 'user' | 'assistant'; content: string; }
export interface HelpQuestion { id: number; question: string; answer: string; }
export interface RepoHelp     { faqQuestions: HelpQuestion[]; suggestions: string[]; }
export interface TourStep     { element?: string | null; title: string; description: string; }
export interface TourSection  { page: string; label: string; steps: TourStep[]; }
export interface TourData     { sections: TourSection[]; }

@Injectable({ providedIn: 'root' })
export class TutorialAiService {
  private http = inject(HttpClient);

  getRepoHelp(repo: string, urls: string[] = []): Observable<RepoHelp> {
    return this.http
      .get<RepoHelp>(`${environment.tutorialApiUrl}/repo-context`, { params: this.buildParams(repo, urls) })
      .pipe(catchError(() => of({ faqQuestions: [], suggestions: [] })));
  }

  getTour(repo: string, urls: string[] = []): Observable<TourData> {
    return this.http
      .get<TourData>(`${environment.tutorialApiUrl}/tour`, { params: this.buildParams(repo, urls) })
      .pipe(
        map(raw => {
          const data = raw as any;
          if (data.steps && !data.sections) {
            return { sections: [{ page: '0', label: 'Tour', steps: data.steps }] } as TourData;
          }
          return raw;
        }),
        catchError(() => of({ sections: [] })),
      );
  }

  ask(message: string, history: ChatMessage[], repo: string, urls: string[] = []): Observable<string> {
    return this.http
      .post<{ answer: string }>(`${environment.tutorialApiUrl}/chat`, { message, history, repo, urls })
      .pipe(
        map(r => r.answer),
        catchError(() => of('Lo siento, no puedo responder en este momento.')),
      );
  }

  private buildParams(repo: string, urls: string[]): Record<string, string> {
    const params: Record<string, string> = { repo };
    if (urls.length) params['urls'] = urls.join(',');
    return params;
  }
}
```

### 4. Componente `tutorial-assistant`

El componente se coloca en el HTML de la página principal del módulo. Recibe dos inputs:

| Input  | Tipo       | Descripción                                                                          |
|--------|------------|--------------------------------------------------------------------------------------|
| `repo` | `string`   | Nombre del repositorio en ADO (para cargar el contexto correcto)                    |
| `page` | `string`   | Página/paso actual del stepper. Default: `"0"`                                      |
| `urls` | `string[]` | URLs externas cuyo contenido se añade al contexto de la IA. Default: `[]`           |

**Módulo con stepper (ej. PortfolioManagement):**

```html
<!-- portfolio-manager.html -->
<tutorial-assistant
  repo="SkCo.PortfolioManagement.Angular"
  [page]="currentStepIndex().toString()"
  [urls]="['https://www.skandia.co/portafolios-fondo-voluntario-de-pension-skandia']"
/>
```

> El tour guiado mostrará automáticamente los pasos correspondientes a la página activa del stepper.

**Módulo de una sola página (ej. ProfileModule):**

```html
<!-- profile-client.component.html -->
<tutorial-assistant
  repo="SkCo.ProfileModule.Angular"
  [urls]="['https://www.skandia.co/portafolios-fondo-voluntario-de-pension-skandia']"
/>
```

### 5. Importar CSS de driver.js

En `angular.json`, dentro de `architect.build.options.styles`:

```json
"styles": [
  "node_modules/driver.js/dist/driver.css",
  "src/styles.css"
]
```

Agrega los estilos de la marca en `styles.css`:

```css
.driver-popover { border: 2px solid #00c853 !important; }
.driver-popover-next-btn,
.driver-popover-prev-btn {
  border-radius: 8px !important;
  border: 1px solid #00c853 !important;
  color: #00c853 !important;
  padding: 4px 14px !important;
}
.driver-popover-next-btn:hover,
.driver-popover-prev-btn:hover {
  background-color: #00c853 !important;
  color: white !important;
  text-shadow: none !important;
}
```

### 6. CORS en producción

Al desplegar la API, agrega los orígenes del front en la variable `ALLOWED_ORIGINS`:

```env
ALLOWED_ORIGINS=https://clientes.skandia.com.co,https://stgcliente.skandia.com.co
```

---

## Estructura del proyecto

```
tutorial-api/
├── src/
│   ├── index.ts        # Express app, rutas, caché por repo
│   ├── chat.ts         # Llamada a Azure AI Responses API
│   ├── generate.ts     # Generación de FAQ, sugerencias y tour (IA)
│   ├── context.ts      # Construcción de system prompts (completo y corto)
│   ├── ado-reader.ts   # Escaneo de archivos desde Azure DevOps
│   └── url-reader.ts   # Fetch y extracción de texto de URLs externas
├── .env                # Variables de entorno (no commitear)
├── package.json
└── tsconfig.json
```
