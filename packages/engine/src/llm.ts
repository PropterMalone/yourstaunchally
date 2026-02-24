/**
 * Local LLM integration via Ollama for in-character DM responses.
 *
 * Each player gets a context-isolated prompt containing only:
 * - Their power, units, and orders (never other players' private info)
 * - Public game state (phase, center counts)
 * - The player's message
 *
 * The LLM wraps bot responses in Diplomacy-themed flavor text.
 * Falls back to plain responses if Ollama is unavailable.
 */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'phi3:mini';
const TIMEOUT_MS = 15_000; // 15s — generous for CPU inference

/** Per-power secretary personalities — each power gets a distinct voice */
const POWER_PERSONAS: Record<string, string> = {
	ENGLAND: `British Foreign Office secretary. Dry, clipped, understated. The occasional "quite" or "I see." Call the player "Minister." You might mention the Navy once in a while. Think of a polite understatement where an American would use three exclamation marks.`,

	FRANCE: `French Foreign Ministry secretary. Cultured, a touch superior, occasional French phrase slipped in naturally (mon Dieu, mais oui, c'est la vie). Call the player "Monsieur le Ministre." You believe in the art of diplomacy — emphasis on art.`,

	GERMANY: `German Foreign Office secretary. Precise, organized, mildly exasperated by inefficiency. The occasional "ja" or "natürlich." Call the player "Herr Minister." You appreciate things being done correctly and on schedule.`,

	RUSSIA: `Russian Foreign Ministry secretary. Fatalistic, dry, sees the dark humor in everything. The occasional "da" or "nyet." Call the player "Your Excellency." Good news and bad news sound roughly the same coming from you.`,

	AUSTRIA: `Austro-Hungarian Foreign Ministry secretary. Harried, managing too many things at once. The occasional "mein Gott" under your breath. Call the player "Your Excellency." You're holding it together, mostly.`,

	ITALY: `Italian Foreign Ministry secretary. Warm, charming, just a little too smooth. The occasional "eccellenza" or "ma certo." Call the player "Eccellenza." You have a flexible relationship with the concept of permanent alliances.`,

	TURKEY: `Ottoman Foreign Ministry secretary. Calm, patient, unflappable. The occasional "efendim" or "patience, Pasha." Call the player "Pasha." You've seen empires come and go. Nothing rattles you.`,
};

const BASE_RULES = `You are a loyal secretary to your sovereign in a game of Diplomacy (the 1959 board game). Brief is better — 1-2 sentences max.

RULES:
- Never reveal other players' orders or private information (you don't have it)
- Never give strategic advice (you are a secretary, not a general)
- Never break character
- If the player is just chatting, respond in character briefly
- If wrapping a bot response, add a SHORT flavor line before or after the data — don't repeat the data itself
- Keep it under 280 characters total`;

function getSystemPrompt(power: string): string {
	const persona = POWER_PERSONAS[power] ?? POWER_PERSONAS['ENGLAND'] ?? '';
	return `${persona}\n\n${BASE_RULES}`;
}

export interface LlmClient {
	/** Generate an in-character response. Returns null if LLM is unavailable. */
	generateResponse(context: LlmContext): Promise<string | null>;
	/** Check if Ollama is reachable and model is loaded */
	isAvailable(): Promise<boolean>;
}

export interface LlmContext {
	power: string;
	phase: string;
	/** What kind of interaction this is */
	situation: 'chat' | 'order_confirm' | 'phase_update' | 'error';
	/** The player's message (for chat responses) */
	playerMessage?: string;
	/** Structured bot data to wrap with flavor (order list, phase info, etc.) */
	botData?: string;
}

export function createLlmClient(ollamaUrl?: string): LlmClient {
	const baseUrl = ollamaUrl ?? process.env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;

	async function generateResponse(context: LlmContext): Promise<string | null> {
		const userMsg = buildUserMessage(context);

		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

			const res = await fetch(`${baseUrl}/api/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: MODEL,
					prompt: userMsg,
					system: getSystemPrompt(context.power),
					stream: false,
					options: {
						temperature: 0.7,
						num_predict: 60, // Keep responses short — 1-2 sentences
						stop: ['\n\n', '---', '-----'],
					},
				}),
				signal: controller.signal,
			});

			clearTimeout(timer);

			if (!res.ok) {
				console.warn(`[llm] Ollama returned ${res.status}`);
				return null;
			}

			const data = (await res.json()) as { response: string };
			return cleanResponse(data.response);
		} catch (error) {
			if ((error as Error).name === 'AbortError') {
				console.warn('[llm] Ollama request timed out');
			} else {
				console.warn(`[llm] Ollama error: ${error}`);
			}
			return null;
		}
	}

	async function isAvailable(): Promise<boolean> {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 3000);
			const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
			clearTimeout(timer);
			if (!res.ok) return false;
			const data = (await res.json()) as { models: { name: string }[] };
			return data.models.some((m) => m.name.startsWith(MODEL.split(':')[0] ?? MODEL));
		} catch {
			return false;
		}
	}

	return { generateResponse, isAvailable };
}

/** Strip meta-commentary, excessive length, and other LLM artifacts */
function cleanResponse(raw: string): string | null {
	let text = raw.trim();

	// Remove lines that look like meta-commentary (starting with dashes, "Note:", etc.)
	text = text
		.split('\n')
		.filter((line) => !line.startsWith('---') && !line.startsWith('Note:') && !line.startsWith('('))
		.join('\n')
		.trim();

	// Strip wrapping quotes if the whole response is quoted
	if (text.startsWith('"') && text.endsWith('"')) {
		text = text.slice(1, -1).trim();
	}

	// Cap at 280 chars (Bluesky DM friendly)
	if (text.length > 280) {
		const truncated = text.slice(0, 277);
		const lastSpace = truncated.lastIndexOf(' ');
		text = lastSpace > 200 ? `${truncated.slice(0, lastSpace)}...` : `${truncated}...`;
	}

	// If cleaning left us with nothing useful, return null
	if (text.length < 5) return null;

	return text;
}

function buildUserMessage(context: LlmContext): string {
	const powerLine = `You serve ${context.power} in phase ${context.phase}.`;

	switch (context.situation) {
		case 'chat':
			return `${powerLine}\n\nThe ${context.power} player says: "${context.playerMessage}"\n\nRespond briefly in character.`;
		case 'order_confirm':
			return `${powerLine}\n\nThe player just submitted their orders. Acknowledge briefly in character. The actual order details will be shown separately — just add a short flavor line.`;
		case 'phase_update':
			return `${powerLine}\n\nA new phase has begun. Add a brief, atmospheric one-liner about the changing situation.`;
		case 'error':
			return `${powerLine}\n\nSomething went wrong processing the player's request. Deliver the bad news diplomatically in one sentence.`;
	}
}
