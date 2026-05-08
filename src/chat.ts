export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY = 10;

export async function chat(
  message: string,
  history: ChatMessage[],
  systemPrompt: string,
  maxTokens = 512,
): Promise<string> {
  const endpoint   = (process.env.AZURE_AI_ENDPOINT   ?? '').replace(/\/$/, '');
  const apiKey     = process.env.AZURE_AI_KEY          ?? '';
  const apiVersion = process.env.AZURE_AI_API_VERSION  ?? '2025-04-01-preview';
  const model      = process.env.AZURE_AI_MODEL        ?? 'gpt-5.3-chat';

  if (!endpoint || !apiKey) {
    throw new Error('AZURE_AI_ENDPOINT y AZURE_AI_KEY deben estar configuradas');
  }

  const recentHistory = history.slice(-MAX_HISTORY);

  // Extrae solo el origen (scheme + host) para evitar que el usuario pegue la URL completa
  const base = new URL(endpoint).origin;
  const url  = `${base}/openai/responses?api-version=${apiVersion}`;
  console.log('[chat] POST', url);

  const body = {
    model,
    max_output_tokens: maxTokens,
    input: [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user',   content: message },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status} ${errText}`);
  }

  const data = await res.json() as any;

  // Responses API: buscar el item de tipo "message" (puede haber un "reasoning" antes)
  const messageItem = data?.output?.find((o: any) => o.type === 'message');
  const text: string | undefined = messageItem?.content?.[0]?.text;

  if (!text) {
    throw new Error('Respuesta vacía del modelo');
  }

  return text;
}
