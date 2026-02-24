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
import { newGame, setOrdersAndProcess } from './adjudicator.js';
import type { MentionNotification } from './bot.js';
import { postMessage, replyToPost } from './bot.js';
import { type DmCommand, type MentionCommand, parseDm, parseMention } from './command-parser.js';
import type { GameDb } from './db.js';
import type { DmSender, InboundDm } from './dm.js';
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
			case 'claim':
				await handleClaim(command, notification, reply);
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
						`Game #${started.gameId} has started! You are ${player.power}.\n\nYour units: ${unitList}\n\nSubmit orders via DM:\n#${started.gameId} ${exampleOrder}; ...\n\nSeparate orders with semicolons. DM "#${started.gameId} possible" to see all options.\n\nDeadline: ${started.phaseDeadline}`,
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
		const centersStr = state.lastCenters ? `\n${formatCenterCounts(state.lastCenters)}` : '';
		const deadlineStr = state.phaseDeadline ? formatRelativeDeadline(state.phaseDeadline) : '?';
		await reply(
			`#${state.gameId} — ${state.currentPhase}\n${pendingStr}${centersStr}\nDeadline: ${deadlineStr}`,
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
			const standings = result.state.lastCenters
				? `\n\n${formatStandings(result.state, result.state.lastCenters)}`
				: '';
			await postMessage(agent, `🤝 Game #${command.gameId} ends in a draw!${standings}`);
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
					`Welcome to game #${command.gameId}! You are ${power}.\n\nOrderable locations: ${unitList}\n\nDM "#${command.gameId} possible" to see all options.\nDeadline: ${state.phaseDeadline}`,
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
			`✓ Orders for ${power} in #${command.gameId} (${orders.length} order${orders.length === 1 ? '' : 's'}):\n${orderSummary}\n\nSend new orders to replace these. DM "#${command.gameId} possible" to see all options.`,
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

			const standings = formatStandings(state, adjResult.centers);
			const msg = victory
				? `👑 Game #${state.gameId}: ${victory.winner} achieves solo victory!\n\n${standings}`
				: `Game #${state.gameId} has ended — draw agreed.\n\n${standings}`;

			if (adjResult.svg) {
				await postWithMapSvg(agent, msg, adjResult.svg, `Final map — Game #${state.gameId}`);
			} else {
				await postMessage(agent, msg);
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
		const phaseMsg = `📜 Game #${state.gameId}: ${seasonName} ${phase.year} ${phaseTypeName}\n\n${formatCenterCounts(adjResult.centers)}\n\nDeadline: ${deadlineDisplay}`;

		if (adjResult.svg) {
			await postWithMapSvg(
				agent,
				phaseMsg,
				adjResult.svg,
				`Diplomacy map — ${seasonName} ${phase.year}`,
			);
		} else {
			await postMessage(agent, phaseMsg);
		}

		// Notify players about the new phase with their current units (non-fatal)
		for (const player of advanced.players) {
			if (player.power) {
				const units = adjResult.units[player.power] ?? [];
				const unitList = units.length > 0 ? `Your units: ${units.join(', ')}` : 'No units';
				try {
					await dmSender.sendDm(
						player.did,
						`New phase: ${adjResult.phase} in #${state.gameId}\n\n${unitList}\n\nSubmit orders: #${state.gameId} ...\nDeadline: ${advanced.phaseDeadline}`,
					);
				} catch (error) {
					console.warn(`[dm] Failed to DM ${player.handle}: ${error}`);
				}
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

const HELP_TEXT = `YourStaunchAlly — Diplomacy on Bluesky

Mention commands:
• new game — Create a game
• join #id — Join
• start #id — Start (2-7 players)
• status #id — Check phase/orders
• draw #id — Vote for draw
• abandon #id — Cancel (creator only)

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
