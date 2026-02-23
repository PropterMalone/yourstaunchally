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
import { newGame, setOrdersAndProcess } from './adjudicator.js';
import type { MentionNotification } from './bot.js';
import { postMessage, replyToPost } from './bot.js';
import { type DmCommand, type MentionCommand, parseDm, parseMention } from './command-parser.js';
import type { GameDb } from './db.js';
import type { DmSender, InboundDm } from './dm.js';

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
}

export function createGameManager(deps: GameManagerDeps) {
	const { agent, dmSender, db } = deps;
	const config = deps.config ?? DEFAULT_GAME_CONFIG;
	const adj = deps.adjudicator ?? { newGame, setOrdersAndProcess };

	const botDid = agent.session?.did ?? '';

	/** Set of processed mention URIs — prevents double-handling across polls */
	const processedMentionUris = new Set<string>();

	async function handleMention(notification: MentionNotification): Promise<void> {
		if (processedMentionUris.has(notification.uri)) return;
		if (notification.authorDid === botDid) return;
		processedMentionUris.add(notification.uri);

		const command = parseMention(notification.text);
		const reply = async (text: string) => {
			await replyToPost(
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

		// Post the announcement
		const announcement = await postMessage(
			agent,
			`🎺 New Diplomacy game #${gameId}!\n\nMention me with "join #${gameId}" to play. Need 3-7 players.\n\n1/7: @${notification.authorHandle}`,
		);
		state = { ...state, announcementPost: announcement };

		db.saveGame(state);
		db.recordGamePost(gameId, announcement.uri, announcement.cid, 'announcement');

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
		};

		db.saveGame(started);

		// DM each player their power assignment
		for (const player of started.players) {
			if (player.power) {
				await dmSender.sendDm(
					player.did,
					`Game #${started.gameId} has started! You are ${player.power}.\n\nSubmit orders via DM: #${started.gameId} A PAR - BUR; A MAR - SPA\n\nDeadline: ${started.phaseDeadline}`,
				);
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

		await postMessage(
			agent,
			`⚔️ Game #${started.gameId} begins! Phase: ${started.currentPhase}\n\n${powerList}${civilDisorder}\n\nDeadline: ${started.phaseDeadline}`,
		);
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
		await reply(
			`#${state.gameId} — ${state.currentPhase}\n${pendingStr}\nDeadline: ${state.phaseDeadline}`,
		);
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
			await postMessage(agent, `🤝 Game #${command.gameId} ends in a draw!`);
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
		await postMessage(agent, `❌ Game #${command.gameId} has been abandoned.`);
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
			case 'unknown':
				await dmSender.sendDm(
					dm.senderDid,
					"I didn't understand that. Send orders like: #gameId A PAR - BUR; A MAR - SPA",
				);
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

		const orderSummary = orders.join('\n');
		await dmSender.sendDm(
			dm.senderDid,
			`Orders received for ${power} in #${command.gameId}:\n${orderSummary}`,
		);

		// Check if all orders are now in
		if (allOrdersSubmitted(result.state)) {
			await processPhase(result.state);
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
			lines.push(`${loc}: ${orders.slice(0, 5).join(', ')}${orders.length > 5 ? '...' : ''}`);
		}

		await dmSender.sendDm(
			dm.senderDid,
			`Possible orders for ${power} (${state.currentPhase}):\n${lines.join('\n')}`,
		);
	}

	/** Process the current phase — adjudicate, update state, post results */
	async function processPhase(state: GameState): Promise<void> {
		if (!state.diplomacyState) return;

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

			const msg = victory
				? `👑 Game #${state.gameId}: ${victory.winner} achieves solo victory!\n\n${formatCenterCounts(adjResult.centers)}`
				: `Game #${state.gameId} has ended.\n\n${formatCenterCounts(adjResult.centers)}`;

			await postMessage(agent, msg);
			return;
		}

		// Advance to next phase
		const advanced = advancePhase(state, adjResult.phase, adjResult.gameState, config);
		db.saveGame(advanced);

		// Parse phase for display
		const phase = parsePhase(adjResult.phase);
		const seasonName = phase.season === 'S' ? 'Spring' : phase.season === 'F' ? 'Fall' : 'Winter';
		const phaseTypeName =
			phase.type === 'M' ? 'Movement' : phase.type === 'R' ? 'Retreats' : 'Adjustments';

		await postMessage(
			agent,
			`📜 Game #${state.gameId}: ${seasonName} ${phase.year} ${phaseTypeName}\n\n${formatCenterCounts(adjResult.centers)}\n\nDeadline: ${advanced.phaseDeadline}`,
		);

		// Notify players about the new phase
		for (const player of advanced.players) {
			if (player.power) {
				await dmSender.sendDm(
					player.did,
					`New phase: ${adjResult.phase} in #${state.gameId}. Submit your orders!\nDeadline: ${advanced.phaseDeadline}`,
				);
			}
		}
	}

	/** Tick — check deadlines on all active games, process expired ones */
	async function tick(): Promise<void> {
		const activeGames = db.loadActiveGames();
		const now = new Date();

		for (const state of activeGames) {
			if (isDeadlinePassed(state, now)) {
				console.log(`[tick] Deadline passed for #${state.gameId}, processing phase`);
				await processPhase(state);
			}
		}
	}

	return {
		handleMention,
		handleDm,
		tick,
		processPhase,
	};
}

const HELP_TEXT = `🎲 YourStaunchAlly — Diplomacy Bot

Commands:
• new game — Start a new game
• join #id — Join a game
• leave #id — Leave (lobby only)
• start #id — Start with current players
• status #id — Check game status
• draw #id — Vote for a draw
• abandon #id — Cancel (creator only)

Orders via DM:
#id A PAR - BUR; A MAR - SPA; F BRE - MAO

Query via DM:
#id orders — Show your submitted orders
#id possible — Show available orders`;
