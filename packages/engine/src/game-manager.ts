/**
 * GameManager — orchestrates game lifecycle.
 * Wires together: command parser, game logic, adjudicator, DB, bot.
 */
import type { AtpAgent } from '@atproto/api';
import {
	DEFAULT_GAME_CONFIG,
	type GameConfig,
	type GameState,
	POWERS,
	addPlayer,
	advancePhase,
	allOrdersSubmitted,
	checkSoloVictory,
	claimPower,
	createGame,
	finishGameSoloVictory,
	formatCenterCounts,
	generateGameId,
	getPendingPowers,
	getPowerForPlayer,
	isDeadlinePassed,
	normalizeOrderString,
	parsePhase,
	removePlayer,
	startGame,
	submitOrders,
	voteDraw,
} from '@yourstaunchally/shared';
import { newGame, renderMap, setOrdersAndProcess } from './adjudicator.js';
import type { MentionNotification } from './bot.js';
import {
	postMessage,
	postThread,
	postWithQuote,
	replyThread,
	replyToPost,
	splitIntoPosts,
} from './bot.js';
import { type DmCommand, type MentionCommand, parseDm, parseMention } from './command-parser.js';
import {
	allOrdersInCommentary,
	centerChangeCommentary,
	drawCommentary,
	gameStartCommentary,
	illegalOrderAnnotation,
	illegalOrderCommentary,
	legalOrderAnnotation,
	nearVictoryCommentary,
	orderReportCommentary,
	phaseCommentary,
	powerAssignmentCommentary,
	soloVictoryCommentary,
} from './commentary.js';
import type { GameDb } from './db.js';
import type { DmSender, InboundDm } from './dm.js';
import type { LabelerClient } from './labeler-client.js';
import type { LlmClient } from './llm.js';
import { postWithMapSvg } from './map-renderer.js';

export interface GameManagerDeps {
	agent: AtpAgent;
	dmSender: DmSender;
	db: GameDb;
	config?: GameConfig;
	/** Override for testing — defaults to real adjudicator */
	adjudicator?: {
		newGame: typeof newGame;
		setOrdersAndProcess: typeof setOrdersAndProcess;
	};
	/** Optional LLM client for in-character DM responses */
	llm?: LlmClient;
	/** Optional labeler client for labeling game posts */
	labeler?: LabelerClient;
}

export function createGameManager(deps: GameManagerDeps) {
	const { agent, dmSender, db } = deps;
	const config = deps.config ?? DEFAULT_GAME_CONFIG;
	const adj = deps.adjudicator ?? { newGame, setOrdersAndProcess };
	const llm = deps.llm ?? null;
	const labeler = deps.labeler ?? null;

	const botDid = agent.session?.did ?? '';

	/** Set of processed mention URIs — prevents double-handling across polls.
	 *  Capped at 1000 entries to prevent unbounded memory growth. */
	const processedMentionUris = new Set<string>();
	const DEDUP_SET_MAX = 1000;
	const DEDUP_SET_EVICT = 500;

	/** Record a game post + label it via external labeler (fire-and-forget) */
	function recordAndLabel(
		uri: string,
		cid: string,
		gameId: string,
		authorDid: string,
		kind: string,
		phase: string | null,
	) {
		db.recordGamePost(uri, cid, gameId, authorDid, kind, phase);
		labeler?.labelPost(uri, 'diplomacy');
	}

	/** Per-game lock — prevents double-adjudication from concurrent tick + order submission */
	const processingGames = new Set<string>();

	/** Per-game consecutive failure count — backoff to avoid hammering a broken adjudicator */
	const gameFailureCount = new Map<string, number>();
	const MAX_CONSECUTIVE_FAILURES = 3;

	async function handleMention(notification: MentionNotification): Promise<void> {
		if (processedMentionUris.has(notification.uri)) return;
		if (notification.authorDid === botDid) return;
		processedMentionUris.add(notification.uri);

		// Cap dedup set to prevent unbounded memory growth
		if (processedMentionUris.size > DEDUP_SET_MAX) {
			const toDelete = [...processedMentionUris].slice(0, DEDUP_SET_EVICT);
			for (const uri of toDelete) processedMentionUris.delete(uri);
		}

		const command = parseMention(notification.text);
		const reply = async (text: string) => {
			await replyThread(
				agent,
				text,
				notification.uri,
				notification.cid,
				notification.uri,
				notification.cid,
			);
		};

		switch (command.type) {
			case 'new_game':
				await handleNewGame(notification, reply);
				break;
			case 'join':
				await handleJoin(command, notification, reply);
				break;
			case 'leave':
				await handleLeave(command, notification, reply);
				break;
			case 'start':
				await handleStart(command, reply);
				break;
			case 'status':
				await handleStatus(command, reply);
				break;
			case 'draw':
				await handleDraw(command, notification, reply);
				break;
			case 'abandon':
				await handleAbandon(command, notification, reply);
				break;
			case 'claim':
				await handleClaim(command, notification, reply);
				break;
			case 'games':
				await handleGames(reply);
				break;
			case 'help':
				await reply(HELP_TEXT);
				break;
			case 'unknown':
				// Ignore unrecognized mentions
				break;
		}
	}

	async function handleNewGame(
		notification: MentionNotification,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const gameId = generateGameId();
		let state = createGame(gameId);

		// Creator auto-joins
		const joinResult = addPlayer(state, notification.authorDid, notification.authorHandle);
		if (!joinResult.ok) {
			await reply(`Failed to create game: ${joinResult.error}`);
			return;
		}
		state = joinResult.state;

		// Persist before posting (crash-safe — if post fails, game still exists in DB)
		db.saveGame(state);

		const announcement = await postMessage(
			agent,
			`🎺 New Diplomacy game #${gameId}!\n\nMention me with "join #${gameId}" to play. Need 3-7 players.\n\n1/7: @${notification.authorHandle}`,
		);
		state = { ...state, announcementPost: announcement };
		db.saveGame(state);
		recordAndLabel(announcement.uri, announcement.cid, gameId, botDid, 'announcement', null);
		labeler?.watchThread(announcement.uri, 'diplomacy');

		await reply(`Game #${gameId} created! Waiting for players (1/${config.maxPlayers}).`);
	}

	async function handleJoin(
		command: MentionCommand & { type: 'join' },
		notification: MentionNotification,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		const result = addPlayer(state, notification.authorDid, notification.authorHandle, config);
		if (!result.ok) {
			await reply(result.error);
			return;
		}

		db.saveGame(result.state);
		const count = result.state.players.length;
		await reply(
			`@${notification.authorHandle} joined #${command.gameId}! (${count}/${config.maxPlayers})`,
		);

		// Auto-start at max players
		if (count >= config.maxPlayers) {
			await doStartGame(result.state, reply);
		}
	}

	async function handleLeave(
		command: MentionCommand & { type: 'leave' },
		notification: MentionNotification,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		const result = removePlayer(state, notification.authorDid);
		if (!result.ok) {
			await reply(result.error);
			return;
		}

		db.saveGame(result.state);
		await reply(
			`@${notification.authorHandle} left #${command.gameId}. (${result.state.players.length}/${config.maxPlayers})`,
		);
	}

	async function handleStart(
		command: MentionCommand & { type: 'start' },
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		await doStartGame(state, reply);
	}

	async function doStartGame(
		state: GameState,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const result = startGame(state, config);
		if (!result.ok) {
			await reply(result.error);
			return;
		}

		// Initialize the diplomacy engine
		const adjResult = await adj.newGame();
		const started = {
			...result.state,
			diplomacyState: adjResult.gameState,
			lastCenters: adjResult.centers,
			lastUnits: adjResult.units,
		};

		db.saveGame(started);

		// DM each player their power assignment with actual units (non-fatal)
		for (const player of started.players) {
			if (player.power) {
				const units = adjResult.units[player.power] ?? [];
				const unitList = units.join(', ');
				const exampleOrder = units[0] ? `${units[0]} H` : 'A PAR H';
				try {
					await dmSender.sendDm(
						player.did,
						`Game #${started.gameId} has started! You are ${player.power}.\n\n${powerAssignmentCommentary(player.power)}\n\nYour units: ${unitList}\n\nSubmit orders via DM:\n#${started.gameId} ${exampleOrder}; ...\n\nSeparate orders with semicolons, commas, or newlines. DM "#${started.gameId} possible" to see all options.\n\nDeadline: ${started.phaseDeadline ? formatAbsoluteDeadline(started.phaseDeadline) : '?'}`,
					);
				} catch (error) {
					console.warn(`[dm] Failed to DM ${player.handle}: ${error}`);
				}
			}
		}

		// Post game start announcement
		const powerList = started.players
			.filter((p) => p.power)
			.map((p) => `${p.power}: @${p.handle}`)
			.join('\n');

		const unassigned = POWERS.filter((power) => !started.players.some((p) => p.power === power));
		const civilDisorder =
			unassigned.length > 0 ? `\n\nCivil disorder: ${unassigned.join(', ')}` : '';

		const deadlineDisplay = started.phaseDeadline
			? formatRelativeDeadline(started.phaseDeadline)
			: '?';
		const startMsg = `⚔️ Game #${started.gameId} begins! ${gameStartCommentary()}\n\n${powerList}${civilDisorder}\n\nPhase: ${started.currentPhase} | Deadline: ${deadlineDisplay}`;

		let startPost: { uri: string; cid: string };
		try {
			const map = await renderMap(started.diplomacyState);
			startPost = await postWithMapSvg(
				agent,
				startMsg,
				map.svg,
				`Diplomacy map — Game #${started.gameId} opening`,
			);
		} catch (error) {
			console.warn(`[map] Failed to render start map: ${error}`);
			startPost = await postThread(agent, startMsg);
		}
		recordAndLabel(
			startPost.uri,
			startPost.cid,
			started.gameId,
			botDid,
			'game_start',
			started.currentPhase,
		);

		// Register per-game feed on Bluesky
		try {
			await registerGameFeed(started.gameId);
		} catch (error) {
			console.warn(`[feed] Failed to register feed for #${started.gameId}: ${error}`);
		}
	}

	async function handleStatus(
		command: MentionCommand & { type: 'status' },
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		if (state.status === 'lobby') {
			const names = state.players.map((p) => `@${p.handle}`).join(', ');
			await reply(
				`#${state.gameId} — Lobby (${state.players.length}/${config.maxPlayers})\nPlayers: ${names || 'none'}`,
			);
			return;
		}

		if (state.status === 'finished') {
			const reason =
				state.endReason === 'solo_victory'
					? `Solo victory by ${state.winner}`
					: state.endReason === 'draw'
						? 'Draw agreed'
						: 'Abandoned';
			await reply(`#${state.gameId} — Finished: ${reason}`);
			return;
		}

		const pending = getPendingPowers(state);
		const pendingStr = pending.length > 0 ? `Waiting on: ${pending.join(', ')}` : 'All orders in!';
		const centersStr = state.lastCenters ? `\n${formatCenterCounts(state.lastCenters)}` : '';
		const deadlineStr = state.phaseDeadline ? formatRelativeDeadline(state.phaseDeadline) : '?';
		await reply(
			`#${state.gameId} — ${state.currentPhase}\n${pendingStr}${centersStr}\nDeadline: ${deadlineStr}`,
		);
	}

	async function handleGames(reply: (text: string) => Promise<void>): Promise<void> {
		const activeGames = db.loadActiveGames();
		const lobbyGames = db.loadLobbyGames();

		if (activeGames.length === 0 && lobbyGames.length === 0) {
			await reply('No active or open games. Start one with "new game"!');
			return;
		}

		const lines: string[] = [];
		for (const game of lobbyGames) {
			lines.push(`#${game.gameId} — Lobby (${game.players.length}/${config.maxPlayers} players)`);
		}
		for (const game of activeGames) {
			const phase = game.currentPhase ?? '?';
			const playerCount = game.players.filter((p) => p.power).length;
			lines.push(`#${game.gameId} — ${phase} (${playerCount} players)`);
		}
		await reply(lines.join('\n'));
	}

	async function handleDraw(
		command: MentionCommand & { type: 'draw' },
		notification: MentionNotification,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		const power = getPowerForPlayer(state, notification.authorDid);
		if (!power) {
			await reply('You are not playing in this game.');
			return;
		}

		const result = voteDraw(state, power);
		if (!result.ok) {
			await reply(result.error);
			return;
		}

		db.saveGame(result.state);

		if (result.drawAchieved) {
			const standings = result.state.lastCenters
				? `\n\n${formatStandings(result.state, result.state.lastCenters)}`
				: '';
			const drawPost = await postThread(
				agent,
				`🤝 Game #${command.gameId} ends in a draw!${standings}`,
			);
			recordAndLabel(
				drawPost.uri,
				drawPost.cid,
				command.gameId,
				botDid,
				'game_over',
				state.currentPhase,
			);
		} else {
			const total = state.players.filter((p) => p.power).length;
			await reply(
				`${power} votes for a draw. (${result.state.drawVote.votedPowers.length}/${total} needed)`,
			);
		}
	}

	async function handleAbandon(
		command: MentionCommand & { type: 'abandon' },
		notification: MentionNotification,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		// Only the first player (creator) can abandon
		if (state.players[0]?.did !== notification.authorDid) {
			await reply('Only the game creator can abandon.');
			return;
		}

		const { abandonGame } = await import('@yourstaunchally/shared');
		const abandoned = abandonGame(state);
		db.saveGame(abandoned);
		const abandonPost = await postMessage(agent, `❌ Game #${command.gameId} has been abandoned.`);
		recordAndLabel(
			abandonPost.uri,
			abandonPost.cid,
			command.gameId,
			botDid,
			'game_over',
			state.currentPhase,
		);
	}

	async function handleClaim(
		command: MentionCommand & { type: 'claim' },
		notification: MentionNotification,
		reply: (text: string) => Promise<void>,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await reply(`Game #${command.gameId} not found.`);
			return;
		}

		const power = command.power as import('@yourstaunchally/shared').Power;
		const result = claimPower(state, notification.authorDid, notification.authorHandle, power);
		if (!result.ok) {
			await reply(result.error);
			return;
		}

		db.saveGame(result.state);
		await reply(
			`@${notification.authorHandle} claims ${power} in #${command.gameId}! No longer in civil disorder.`,
		);

		// DM the new player with their units and instructions
		if (state.diplomacyState) {
			try {
				const { getPossibleOrders } = await import('./adjudicator.js');
				const possible = await getPossibleOrders(state.diplomacyState);
				const powerOrders = possible.possibleOrders[power];
				const unitLocs = powerOrders ? Object.keys(powerOrders) : [];
				const unitList = unitLocs.length > 0 ? unitLocs.join(', ') : 'No units this phase';
				await dmSender.sendDm(
					notification.authorDid,
					`Welcome to game #${command.gameId}! You are ${power}.\n\nOrderable locations: ${unitList}\n\nDM "#${command.gameId} possible" to see all options.\nDeadline: ${state.phaseDeadline ? formatAbsoluteDeadline(state.phaseDeadline) : '?'}`,
				);
			} catch (error) {
				console.warn(`[dm] Failed to DM ${notification.authorHandle}: ${error}`);
			}
		}
	}

	async function handleDm(dm: InboundDm): Promise<void> {
		const command = parseDm(dm.text);

		switch (command.type) {
			case 'submit_orders':
				await handleOrderSubmission(command, dm);
				break;
			case 'show_orders':
				await handleShowOrders(command, dm);
				break;
			case 'show_possible':
				await handleShowPossible(command, dm);
				break;
			case 'my_games':
				await handleMyGames(dm);
				break;
			case 'help':
				await dmSender.sendDm(
					dm.senderDid,
					'DM commands:\n\n#gameId A PAR - BUR; F BRE - MAO \u2014 Submit orders\n#gameId possible \u2014 See legal orders\n#gameId orders \u2014 Review submitted orders\nmy games \u2014 List your active games\n\nSeparate orders with semicolons, commas, or newlines. All deadlines are UTC.',
				);
				break;
			case 'game_menu':
				await dmSender.sendDm(
					dm.senderDid,
					`Game #${command.gameId} \u2014 what would you like to do?\n\n#${command.gameId} possible \u2014 See legal orders\n#${command.gameId} orders \u2014 Review submitted orders\n#${command.gameId} A PAR - BUR; ... \u2014 Submit orders`,
				);
				break;
			case 'unknown':
				await handleUnknownDm(dm);
				break;
		}
	}

	async function handleOrderSubmission(
		command: DmCommand & { type: 'submit_orders' },
		dm: InboundDm,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await dmSender.sendDm(dm.senderDid, `Game #${command.gameId} not found.`);
			return;
		}

		const power = getPowerForPlayer(state, dm.senderDid);
		if (!power) {
			await dmSender.sendDm(dm.senderDid, 'You are not playing in this game.');
			return;
		}

		const orders = command.orderLines.map(normalizeOrderString);
		const result = submitOrders(state, power, orders);
		if (!result.ok) {
			await dmSender.sendDm(dm.senderDid, result.error);
			return;
		}

		db.saveGame(result.state);

		// Validate each order against the legal set from the diplomacy engine
		let illegalWarning = '';
		if (state.diplomacyState) {
			try {
				const { getPossibleOrders } = await import('./adjudicator.js');
				const possible = await getPossibleOrders(state.diplomacyState);
				const powerOrders = possible.possibleOrders[power];
				const allLegal = powerOrders ? Object.values(powerOrders).flat() : [];

				const annotated: string[] = [];
				let illegalCount = 0;
				for (const order of orders) {
					if (allLegal.some((legal) => legal.toUpperCase() === order.toUpperCase())) {
						annotated.push(legalOrderAnnotation(order));
					} else {
						annotated.push(illegalOrderAnnotation(order));
						illegalCount++;
					}
				}

				if (illegalCount > 0) {
					illegalWarning = `\n\n${illegalOrderCommentary(illegalCount, orders.length)}`;
				}

				const orderSummary = annotated.join('\n');
				await dmSender.sendDm(
					dm.senderDid,
					`Orders for ${power} in #${command.gameId} (${orders.length} order${orders.length === 1 ? '' : 's'}):\n${orderSummary}${illegalWarning}\n\nSend new orders to replace these.`,
				);
			} catch (error) {
				// Validation failed — still confirm orders were saved, just skip validation
				console.warn(`[orders] Validation failed for #${command.gameId}: ${error}`);
				const orderSummary = orders.join('\n');
				await dmSender.sendDm(
					dm.senderDid,
					`✓ Orders for ${power} in #${command.gameId} (${orders.length} order${orders.length === 1 ? '' : 's'}):\n${orderSummary}\n\nSend new orders to replace these. DM "#${command.gameId} possible" to see all options.`,
				);
			}
		} else {
			const orderSummary = orders.join('\n');
			await dmSender.sendDm(
				dm.senderDid,
				`✓ Orders for ${power} in #${command.gameId} (${orders.length} order${orders.length === 1 ? '' : 's'}):\n${orderSummary}\n\nSend new orders to replace these. DM "#${command.gameId} possible" to see all options.`,
			);
		}

		// All orders in → shorten deadline to 20-min grace period (so players can revise)
		if (allOrdersSubmitted(result.state)) {
			const GRACE_PERIOD_MS = 20 * 60 * 1000;
			const graceDeadline = new Date(Date.now() + GRACE_PERIOD_MS).toISOString();
			const currentDeadline = result.state.phaseDeadline;

			// Only shorten — never extend past the original deadline
			if (!currentDeadline || new Date(graceDeadline) < new Date(currentDeadline)) {
				const updated = { ...result.state, phaseDeadline: graceDeadline };
				db.saveGame(updated);
				console.log(
					`[orders] All orders in for #${command.gameId}, grace period until ${graceDeadline}`,
				);

				// Public announcement (QT previous thread for connective tissue)
				const graceMsg = `⏰ Game #${command.gameId} — all orders are in! ${allOrdersInCommentary()}\n\nAdjudication in 20 minutes. You may revise orders until then.`;
				const prev = db.getLatestGamePost(command.gameId);
				const gracePost = prev
					? await postWithQuote(agent, graceMsg, prev.uri, prev.cid)
					: await postThread(agent, graceMsg);
				recordAndLabel(
					gracePost.uri,
					gracePost.cid,
					command.gameId,
					botDid,
					'grace_period',
					result.state.currentPhase,
				);

				// DM all players
				for (const player of result.state.players) {
					if (player.did) {
						await dmSender.sendDm(
							player.did,
							`⏰ All orders are in for #${command.gameId}. Adjudication in 20 minutes — DM revised orders now if you want to change anything.`,
						);
					}
				}
			}
		}
	}

	async function handleShowOrders(
		command: DmCommand & { type: 'show_orders' },
		dm: InboundDm,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await dmSender.sendDm(dm.senderDid, `Game #${command.gameId} not found.`);
			return;
		}

		const power = getPowerForPlayer(state, dm.senderDid);
		if (!power) {
			await dmSender.sendDm(dm.senderDid, 'You are not playing in this game.');
			return;
		}

		const phaseOrders = state.currentOrders[power];
		if (!phaseOrders) {
			await dmSender.sendDm(dm.senderDid, `No orders submitted yet for ${power}.`);
			return;
		}

		await dmSender.sendDm(
			dm.senderDid,
			`Current orders for ${power}:\n${phaseOrders.orders.join('\n')}`,
		);
	}

	async function handleShowPossible(
		command: DmCommand & { type: 'show_possible' },
		dm: InboundDm,
	): Promise<void> {
		const state = db.loadGame(command.gameId);
		if (!state) {
			await dmSender.sendDm(dm.senderDid, `Game #${command.gameId} not found.`);
			return;
		}

		const power = getPowerForPlayer(state, dm.senderDid);
		if (!power) {
			await dmSender.sendDm(dm.senderDid, 'You are not playing in this game.');
			return;
		}

		if (!state.diplomacyState) {
			await dmSender.sendDm(dm.senderDid, 'Game state not initialized.');
			return;
		}

		const { getPossibleOrders } = await import('./adjudicator.js');
		const possible = await getPossibleOrders(state.diplomacyState);
		const powerOrders = possible.possibleOrders[power];
		if (!powerOrders || Object.keys(powerOrders).length === 0) {
			await dmSender.sendDm(dm.senderDid, `No orderable units for ${power} this phase.`);
			return;
		}

		const lines: string[] = [];
		for (const [loc, orders] of Object.entries(powerOrders)) {
			lines.push(
				`${loc} (${orders.length} options): ${orders.slice(0, 4).join(', ')}${orders.length > 4 ? ` (+${orders.length - 4} more)` : ''}`,
			);
		}

		// Bluesky DM limit is ~1000 chars — truncate if needed
		let msg = `${power} (${state.currentPhase}) — ${Object.keys(powerOrders).length} units:\n\n${lines.join('\n')}`;
		if (msg.length > 950) {
			msg = `${msg.slice(0, 947)}...`;
		}

		await dmSender.sendDm(dm.senderDid, msg);
	}

	async function handleMyGames(dm: InboundDm): Promise<void> {
		const activeGames = db.loadActiveGames();
		const lobbyGames = db.loadLobbyGames();
		const allGames = [...lobbyGames, ...activeGames];
		const myGames = allGames.filter((g) => g.players.some((p) => p.did === dm.senderDid));

		if (myGames.length === 0) {
			await dmSender.sendDm(dm.senderDid, 'You are not in any active games.');
			return;
		}

		const lines = myGames.map((g) => {
			const player = g.players.find((p) => p.did === dm.senderDid);
			const power = player?.power ?? 'unassigned';
			if (g.status === 'lobby') return `#${g.gameId} — Lobby (${power})`;
			const phase = g.currentPhase ?? '?';
			const hasOrders = power !== 'unassigned' && g.currentOrders[power];
			const orderStatus = hasOrders ? 'orders in' : 'orders pending';
			return `#${g.gameId} — ${phase} (${power}, ${orderStatus})`;
		});
		await dmSender.sendDm(dm.senderDid, `Your games:\n${lines.join('\n')}`);
	}

	/** Handle unrecognized DMs — use LLM for in-character response, or stay silent */
	async function handleUnknownDm(dm: InboundDm): Promise<void> {
		if (!llm) return; // No LLM configured — stay silent

		// Find the player's game context for the LLM prompt
		const activeGames = db.loadActiveGames();
		const playerGame = activeGames.find((g) => g.players.some((p) => p.did === dm.senderDid));

		if (!playerGame) return; // Not a player — ignore

		const player = playerGame.players.find((p) => p.did === dm.senderDid);
		const power = player?.power ?? 'Unknown';

		try {
			const response = await llm.generateResponse({
				power,
				phase: playerGame.currentPhase ?? 'unknown',
				situation: 'chat',
				playerMessage: dm.text,
			});

			if (response) {
				await dmSender.sendDm(dm.senderDid, response);
			}
		} catch (error) {
			// LLM failure is non-fatal — just stay silent
			console.warn(`[llm] Failed to generate response: ${error}`);
		}
	}

	/** Post submitted orders + outcomes as replies to the phase result post.
	 *  One reply per power. Chains within a power if orders exceed 300 graphemes. */
	async function postOrdersReply(
		state: GameState,
		orderResults: { orders: Record<string, string[]>; results: Record<string, string[]> },
		rootPost: { uri: string; cid: string },
	): Promise<void> {
		let parent = rootPost;

		for (const power of POWERS) {
			const orders = orderResults.orders[power];
			if (!orders || orders.length === 0) continue;

			const player = state.players.find((p) => p.power === power);
			const handle = player ? `@${player.handle}` : 'Civil Disorder';
			const flavor = orderReportCommentary(power as import('@yourstaunchally/shared').Power);

			const orderLines: string[] = [];
			for (const order of orders) {
				const parts = order.split(/\s+/);
				const unitKey = `${parts[0]} ${parts[1]}`;
				const results = orderResults.results[unitKey] ?? [];
				const outcome = results.length > 0 ? ` [${results.join(', ')}]` : '';
				orderLines.push(`  ${order}${outcome}`);
			}

			const text = `${power} (${handle})\n${flavor}\n\n${orderLines.join('\n')}`;
			const chunks = splitIntoPosts(text);

			for (const chunk of chunks) {
				const reply = await replyToPost(
					agent,
					chunk,
					parent.uri,
					parent.cid,
					rootPost.uri,
					rootPost.cid,
				);
				recordAndLabel(reply.uri, reply.cid, state.gameId, botDid, 'orders', state.currentPhase);
				parent = reply;
			}
		}
	}

	/** Process the current phase — adjudicate, update state, post results.
	 *  Guarded by per-game lock to prevent double-adjudication from concurrent
	 *  tick() deadline + handleOrderSubmission completing at the same moment. */
	async function processPhase(state: GameState): Promise<void> {
		if (!state.diplomacyState) return;

		// Acquire per-game lock — if already processing, skip silently
		if (processingGames.has(state.gameId)) {
			console.log(`[phase] Skipping #${state.gameId} — already being processed`);
			return;
		}
		processingGames.add(state.gameId);

		try {
			// Build orders map for the adjudicator
			const ordersMap: Record<string, string[]> = {};
			for (const power of POWERS) {
				const phaseOrders = state.currentOrders[power];
				if (phaseOrders) {
					ordersMap[power] = phaseOrders.orders;
				}
				// Powers without orders → civil disorder (hold all units, handled by Python lib)
			}

			const adjResult = await adj.setOrdersAndProcess(
				state.diplomacyState,
				ordersMap,
				true, // render map
			);

			// Adjudication succeeded — clear failure count
			gameFailureCount.delete(state.gameId);

			// Check for solo victory
			const victory = checkSoloVictory(adjResult.centers);
			if (victory || adjResult.isGameDone) {
				const finished = victory
					? finishGameSoloVictory(state, victory.winner)
					: {
							...state,
							status: 'finished' as const,
							finishedAt: new Date().toISOString(),
							endReason: 'draw' as const,
							winner: null,
						};

				db.saveGame(finished);

				const standings = formatStandings(state, adjResult.centers);
				const msg = victory
					? `👑 Game #${state.gameId}: ${soloVictoryCommentary(victory.winner)}\n\n${standings}`
					: `🤝 Game #${state.gameId}: ${drawCommentary()}\n\n${standings}`;

				const prevPost = db.getLatestGamePost(state.gameId);
				const victoryPost = adjResult.svg
					? await postWithMapSvg(agent, msg, adjResult.svg, `Final map — Game #${state.gameId}`)
					: prevPost
						? await postWithQuote(agent, msg, prevPost.uri, prevPost.cid)
						: await postThread(agent, msg);
				recordAndLabel(
					victoryPost.uri,
					victoryPost.cid,
					state.gameId,
					botDid,
					'game_over',
					state.currentPhase,
				);

				// Reply with submitted orders on the final post too
				if (adjResult.orderResults) {
					try {
						await postOrdersReply(state, adjResult.orderResults, victoryPost);
					} catch (error) {
						console.warn(`[phase] Failed to post orders reply for #${state.gameId}: ${error}`);
					}
				}
				return;
			}

			// Advance to next phase, store latest centers/units for status queries
			const advanced = {
				...advancePhase(state, adjResult.phase, adjResult.gameState, config),
				lastCenters: adjResult.centers,
				lastUnits: adjResult.units,
			};
			db.saveGame(advanced);

			// Parse phase for display
			const phase = parsePhase(adjResult.phase);
			const seasonName = phase.season === 'S' ? 'Spring' : phase.season === 'F' ? 'Fall' : 'Winter';
			const phaseTypeName =
				phase.type === 'M' ? 'Movement' : phase.type === 'R' ? 'Retreats' : 'Adjustments';

			const deadlineDisplay = advanced.phaseDeadline
				? formatRelativeDeadline(advanced.phaseDeadline)
				: '?';

			// Build center change commentary (compare before/after)
			const centerChanges = buildCenterChangeLines(state.lastCenters ?? {}, adjResult.centers);

			// Near-victory warning
			const victoryWarnings = buildNearVictoryWarnings(adjResult.centers);

			const extras = [...centerChanges, ...victoryWarnings];
			const extrasBlock = extras.length > 0 ? `\n\n${extras.join('\n')}` : '';

			const phaseMsg = `📜 Game #${state.gameId}: ${seasonName} ${phase.year} ${phaseTypeName}\n\n${phaseCommentary(phase.type)}\n\n${formatCenterCounts(adjResult.centers)}${extrasBlock}\n\nDeadline: ${deadlineDisplay}`;

			// QT previous thread for connective tissue (maps skip QT — they're visual context)
			const prevPost = db.getLatestGamePost(state.gameId);
			const phasePost = adjResult.svg
				? await postWithMapSvg(
						agent,
						phaseMsg,
						adjResult.svg,
						`Diplomacy map — ${seasonName} ${phase.year}`,
					)
				: prevPost
					? await postWithQuote(agent, phaseMsg, prevPost.uri, prevPost.cid)
					: await postThread(agent, phaseMsg);
			recordAndLabel(phasePost.uri, phasePost.cid, state.gameId, botDid, 'phase', adjResult.phase);

			// Reply with the submitted orders so everyone can see what happened
			if (adjResult.orderResults) {
				try {
					await postOrdersReply(state, adjResult.orderResults, phasePost);
				} catch (error) {
					console.warn(`[phase] Failed to post orders reply for #${state.gameId}: ${error}`);
				}
			}

			// Notify players about the new phase with their current units (non-fatal)
			for (const player of advanced.players) {
				if (player.power) {
					const units = adjResult.units[player.power] ?? [];
					const unitList = units.length > 0 ? `Your units: ${units.join(', ')}` : 'No units';
					try {
						await dmSender.sendDm(
							player.did,
							`New phase: ${adjResult.phase} in #${state.gameId}\n\n${unitList}\n\nSubmit orders: #${state.gameId} ...\nDeadline: ${advanced.phaseDeadline ? formatAbsoluteDeadline(advanced.phaseDeadline) : '?'}`,
						);
					} catch (error) {
						console.warn(`[dm] Failed to DM ${player.handle}: ${error}`);
					}
				}
			}
		} finally {
			processingGames.delete(state.gameId);
		}
	}

	/** Status update posts at 3 fixed checkpoints to minimize post volume:
	 *  ~24h, ~6h, ~1h remaining. Returns the interval to wait before the next post. */
	function statusUpdateInterval(msRemaining: number): number {
		const HOUR = 60 * 60 * 1000;
		if (msRemaining > 24 * HOUR) return 24 * HOUR;
		if (msRemaining > 6 * HOUR) return 18 * HOUR; // next at ~6h
		if (msRemaining > 1 * HOUR) return 5 * HOUR; // next at ~1h
		return 24 * HOUR; // already past the last checkpoint — don't post again
	}

	/** Post a periodic status update for a game if enough time has passed */
	async function maybePostStatusUpdate(state: GameState): Promise<void> {
		if (!state.phaseDeadline) return;

		const lastStatusKey = `status_post_${state.gameId}`;
		const lastStatus = db.getBotState(lastStatusKey);
		const now = Date.now();
		const msRemaining = new Date(state.phaseDeadline).getTime() - now;
		const interval = statusUpdateInterval(msRemaining);

		if (lastStatus && now - Number(lastStatus) < interval) return;

		const ordersIn = Object.keys(state.currentOrders).length;
		const totalPlayers = state.players.filter((p) => p.power).length;

		// Don't post if all orders are already in (grace period handles that)
		if (ordersIn >= totalPlayers) return;

		const timeLeft = formatRelativeDeadline(state.phaseDeadline as string);

		const statusMsg = `📊 Game #${state.gameId} — ${state.currentPhase}\n\n${ordersIn}/${totalPlayers} orders in. ${timeLeft}.`;

		try {
			const prevPost = db.getLatestGamePost(state.gameId);
			const statusPost = prevPost
				? await postWithQuote(agent, statusMsg, prevPost.uri, prevPost.cid)
				: await postThread(agent, statusMsg);
			recordAndLabel(
				statusPost.uri,
				statusPost.cid,
				state.gameId,
				botDid,
				'status',
				state.currentPhase,
			);
			db.setBotState(lastStatusKey, String(now));
			console.log(
				`[status] Posted update for #${state.gameId}: ${ordersIn}/${totalPlayers} orders`,
			);
		} catch (error) {
			console.warn(`[status] Failed to post update for #${state.gameId}: ${error}`);
		}
	}

	/** Tick — check deadlines on all active games, process expired ones */
	async function tick(): Promise<void> {
		const activeGames = db.loadActiveGames();
		const now = new Date();

		for (const state of activeGames) {
			// Periodic status update (non-blocking, before deadline check)
			try {
				await maybePostStatusUpdate(state);
			} catch (error) {
				console.warn(`[status] Error checking status update for #${state.gameId}: ${error}`);
			}

			if (isDeadlinePassed(state, now)) {
				// Backoff: skip games that have failed too many times consecutively
				const failures = gameFailureCount.get(state.gameId) ?? 0;
				if (failures >= MAX_CONSECUTIVE_FAILURES) {
					// Only retry every 10th tick (~10 min) after hitting the limit
					const backoffTick = failures - MAX_CONSECUTIVE_FAILURES;
					if (backoffTick % 10 !== 0) {
						gameFailureCount.set(state.gameId, failures + 1);
						continue;
					}
				}

				try {
					console.log(`[tick] Deadline passed for #${state.gameId}, processing phase`);
					await processPhase(state);
				} catch (error) {
					const newCount = (gameFailureCount.get(state.gameId) ?? 0) + 1;
					gameFailureCount.set(state.gameId, newCount);
					console.error(`[tick] Error processing #${state.gameId} (failure ${newCount}):`, error);
				}
			}
		}
	}

	async function registerGameFeed(gameId: string): Promise<void> {
		const feedPublisherDid = process.env['FEED_PUBLISHER_DID'];
		if (!feedPublisherDid) return; // Feed not configured, skip silently
		await agent.com.atproto.repo.putRecord({
			repo: botDid,
			collection: 'app.bsky.feed.generator',
			rkey: `diplo-${gameId}`,
			record: {
				did: feedPublisherDid,
				displayName: `Diplomacy #${gameId}`,
				description: `Follow Diplomacy game #${gameId} — phase results, maps, and standings.`,
				createdAt: new Date().toISOString(),
			},
		});
		console.log(`[feed] Registered feed for game #${gameId}`);
	}

	return {
		handleMention,
		handleDm,
		tick,
		processPhase,
	};
}

const HELP_TEXT = `YourStaunchAlly — Diplomacy on Bluesky

Mention commands:
• new game — Create a game
• join #id — Join
• start #id — Start (2-7 players)
• status #id — Check phase/orders
• draw #id — Vote for draw
• claim #id POWER — Claim unassigned power
• abandon #id — Cancel (creator only)
• games — List active games

DM to submit orders:
#id A PAR - BUR; F BRE - MAO; A MAR S A PAR - BUR

DM queries:
#id possible — See your options
#id orders — See submitted orders

H=hold, -=move, S=support, C=convoy`;

function formatStandings(state: GameState, centers: Record<string, string[]>): string {
	return Object.entries(centers)
		.filter(([_, c]) => c.length > 0)
		.sort((a, b) => b[1].length - a[1].length)
		.map(([power, c]) => {
			const player = state.players.find((p) => p.power === power);
			const handle = player ? `@${player.handle}` : 'Civil Disorder';
			return `${power} (${handle}): ${c.length}`;
		})
		.join('\n');
}

/** Compare before/after center maps and generate commentary for notable changes */
function buildCenterChangeLines(
	before: Record<string, string[]>,
	after: Record<string, string[]>,
): string[] {
	const lines: string[] = [];
	for (const [power, newCenters] of Object.entries(after)) {
		const oldCenters = before[power] ?? [];
		const gained = newCenters.filter((c) => !oldCenters.includes(c));
		const lost = oldCenters.filter((c) => !newCenters.includes(c));
		const line = centerChangeCommentary(
			power as import('@yourstaunchally/shared').Power,
			gained,
			lost,
		);
		if (line) lines.push(line);
	}
	return lines;
}

/** Generate near-victory warnings for any power approaching 18 centers */
function buildNearVictoryWarnings(centers: Record<string, string[]>): string[] {
	const lines: string[] = [];
	for (const [power, powerCenters] of Object.entries(centers)) {
		const warning = nearVictoryCommentary(
			power as import('@yourstaunchally/shared').Power,
			powerCenters.length,
		);
		if (warning) lines.push(warning);
	}
	return lines;
}

function formatRelativeDeadline(isoDeadline: string): string {
	const diff = new Date(isoDeadline).getTime() - Date.now();
	if (diff <= 0) return 'passed';
	const hours = Math.floor(diff / (60 * 60 * 1000));
	const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
	if (hours >= 24) {
		const days = Math.floor(hours / 24);
		const remainingHours = hours % 24;
		return `${days}d ${remainingHours}h remaining`;
	}
	if (hours > 0) return `${hours}h ${minutes}m remaining`;
	return `${minutes}m remaining`;
}

/** Format an ISO deadline as a readable absolute time for DMs: "Feb 26, 19:30 UTC" */
function formatAbsoluteDeadline(isoDeadline: string): string {
	const d = new Date(isoDeadline);
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	const month = months[d.getUTCMonth()];
	const day = d.getUTCDate();
	const hour = d.getUTCHours().toString().padStart(2, '0');
	const min = d.getUTCMinutes().toString().padStart(2, '0');
	return `${month} ${day}, ${hour}:${min} UTC`;
}
