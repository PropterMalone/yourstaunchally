/**
 * Parse mention commands and DM order submissions.
 *
 * Mention commands (public):
 *   @yourstaunchally new game        → create a game
 *   @yourstaunchally join #abc123    → join a game
 *   @yourstaunchally leave #abc123   → leave a game (lobby only)
 *   @yourstaunchally start #abc123   → manually start (3-6 players)
 *   @yourstaunchally status #abc123  → game status
 *   @yourstaunchally draw #abc123    → vote for a draw
 *   @yourstaunchally abandon #abc123 → abandon a game (creator only)
 *   @yourstaunchally claim #abc123 FRANCE → claim a power in an active game
 *   @yourstaunchally help            → show help text
 *
 * DM commands (private orders):
 *   #abc123 A PAR - BUR; A MAR - SPA; F BRE - MAO
 *   #abc123 orders              → show current submitted orders
 *   #abc123 possible            → show possible orders for your power
 */

export type MentionCommand =
	| { type: 'new_game' }
	| { type: 'join'; gameId: string }
	| { type: 'leave'; gameId: string }
	| { type: 'start'; gameId: string }
	| { type: 'status'; gameId: string }
	| { type: 'draw'; gameId: string }
	| { type: 'abandon'; gameId: string }
	| { type: 'claim'; gameId: string; power: string }
	| { type: 'games' }
	| { type: 'help' }
	| { type: 'unknown'; text: string };

export type DmCommand =
	| { type: 'submit_orders'; gameId: string; orderLines: string[] }
	| { type: 'show_orders'; gameId: string }
	| { type: 'show_possible'; gameId: string }
	| { type: 'my_games' }
	| { type: 'help' }
	| { type: 'game_menu'; gameId: string }
	| { type: 'unknown'; text: string };

const GAME_ID_RE = /#([a-z0-9]{4,8})/i;

/**
 * Parse a mention text into a command.
 * Strips the @handle prefix before parsing.
 */
export function parseMention(text: string): MentionCommand {
	// Remove @handle prefix (anything before first space that starts with @)
	const cleaned = text
		.replace(/@[\w.-]+\s*/g, '')
		.trim()
		.toLowerCase();

	if (cleaned === 'help' || cleaned === '?') {
		return { type: 'help' };
	}

	if (cleaned.startsWith('new game') || cleaned === 'new') {
		return { type: 'new_game' };
	}

	if (cleaned === 'games' || cleaned === 'list') {
		return { type: 'games' };
	}

	const gameIdMatch = text.match(GAME_ID_RE);
	const gameId = gameIdMatch?.[1]?.toLowerCase();

	if (!gameId) {
		return { type: 'unknown', text };
	}

	if (cleaned.startsWith('join')) {
		return { type: 'join', gameId };
	}
	if (cleaned.startsWith('leave') || cleaned.startsWith('quit')) {
		return { type: 'leave', gameId };
	}
	if (cleaned.startsWith('start')) {
		return { type: 'start', gameId };
	}
	if (cleaned.startsWith('status') || cleaned.startsWith('state')) {
		return { type: 'status', gameId };
	}
	if (cleaned.startsWith('draw')) {
		return { type: 'draw', gameId };
	}
	if (cleaned.startsWith('abandon') || cleaned.startsWith('cancel')) {
		return { type: 'abandon', gameId };
	}
	if (cleaned.startsWith('claim')) {
		// Extract power name from text (case-insensitive): "claim #abc FRANCE"
		const powerMatch = text.match(/claim\s+#\w+\s+(\w+)/i);
		if (powerMatch?.[1]) {
			return { type: 'claim', gameId, power: powerMatch[1].toUpperCase() };
		}
		return { type: 'unknown', text };
	}

	return { type: 'unknown', text };
}

/**
 * Parse a DM text into a command.
 * DMs start with #gameId followed by orders or a query keyword.
 */
export function parseDm(text: string): DmCommand {
	const trimmed = text.trim();
	const lower = trimmed.toLowerCase();

	if (lower === 'my games' || lower === 'games' || lower === 'list') {
		return { type: 'my_games' };
	}

	if (lower === 'help' || lower === '?') {
		return { type: 'help' };
	}

	const gameIdMatch = trimmed.match(GAME_ID_RE);

	if (!gameIdMatch?.[1]) {
		return { type: 'unknown', text: trimmed };
	}

	const gameId = gameIdMatch[1].toLowerCase();
	// Everything after the game ID
	const matchIndex = gameIdMatch.index ?? 0;
	const rest = trimmed.slice(matchIndex + gameIdMatch[0].length).trim();

	if (!rest || rest.length === 0) {
		return { type: 'game_menu', gameId };
	}

	// Strip trailing punctuation/quotes for keyword matching (smart quotes, periods, etc.)
	const lowerRest = rest.toLowerCase().replace(/[\s""\u201C\u201D''\u2018\u2019.,!?]+$/g, '');

	if (
		lowerRest === 'orders' ||
		lowerRest === 'my orders' ||
		lowerRest === 'show orders' ||
		lowerRest === 'status'
	) {
		return { type: 'show_orders', gameId };
	}

	if (
		lowerRest === 'possible' ||
		lowerRest === 'options' ||
		lowerRest === 'show possible' ||
		lowerRest === 'help'
	) {
		return { type: 'show_possible', gameId };
	}

	// Parse as order lines (semicolon, comma, or newline separated)
	const orderLines = rest
		.split(/[;,\n]/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (orderLines.length > 0) {
		return { type: 'submit_orders', gameId, orderLines };
	}

	return { type: 'unknown', text: trimmed };
}
