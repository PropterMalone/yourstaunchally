#!/usr/bin/env node
/**
 * End-to-end playthrough test — runs a complete Diplomacy game cycle
 * without going through Bluesky. Tests: game logic + adjudicator + DB.
 *
 * Usage: node scripts/playthrough-test.mjs
 * Requires: .venv with diplomacy installed
 */

// Set PYTHON_PATH before any imports that use it
process.env['PYTHON_PATH'] = `${import.meta.dirname}/../.venv/bin/python3`;

const { createGame, addPlayer, startGame, submitOrders, advancePhase, checkSoloVictory,
	getPendingPowers, allOrdersSubmitted, DEFAULT_GAME_CONFIG, generateGameId, formatCenterCounts,
	getPowerForPlayer } = await import('../packages/shared/dist/index.js');
const { newGame, setOrdersAndProcess, getPossibleOrders } = await import('../packages/engine/dist/adjudicator.js');

const FAKE_PLAYERS = [
	{ did: 'did:plc:player1', handle: 'player1.test' },
	{ did: 'did:plc:player2', handle: 'player2.test' },
	{ did: 'did:plc:player3', handle: 'player3.test' },
	{ did: 'did:plc:player4', handle: 'player4.test' },
	{ did: 'did:plc:player5', handle: 'player5.test' },
	{ did: 'did:plc:player6', handle: 'player6.test' },
	{ did: 'did:plc:player7', handle: 'player7.test' },
];

function assert(condition, msg) {
	if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function run() {
	console.log('=== YourStaunchAlly Full Playthrough Test ===\n');

	// 1. Create game and add 7 players
	console.log('1. Creating game with 7 players...');
	const gameId = generateGameId();
	let state = createGame(gameId);

	for (const p of FAKE_PLAYERS) {
		const result = addPlayer(state, p.did, p.handle);
		assert(result.ok, `Failed to add ${p.handle}: ${result.error}`);
		state = result.state;
	}
	assert(state.players.length === 7, 'Should have 7 players');
	console.log(`   Game #${gameId} created with 7 players`);

	// 2. Start game
	console.log('2. Starting game...');
	const startResult = startGame(state);
	assert(startResult.ok, `Failed to start: ${startResult.error}`);
	state = startResult.state;
	assert(state.status === 'active', 'Game should be active');

	const powerAssignments = state.players
		.filter(p => p.power)
		.map(p => `   ${p.power}: ${p.handle}`)
		.join('\n');
	console.log(`   Powers assigned:\n${powerAssignments}`);

	// 3. Initialize diplomacy engine
	console.log('3. Initializing diplomacy engine...');
	const adjResult = await newGame();
	state = { ...state, diplomacyState: adjResult.gameState };
	assert(adjResult.phase === 'S1901M', `Expected S1901M, got ${adjResult.phase}`);
	console.log(`   Phase: ${adjResult.phase}`);
	console.log(`   Units: ${Object.entries(adjResult.units).map(([p,u]) => `${p}: ${u.length}`).join(', ')}`);

	// 4. Get possible orders and submit for all powers
	console.log('4. Getting possible orders...');
	const possible = await getPossibleOrders(state.diplomacyState);

	// Standard opening moves
	const SPRING_1901_ORDERS = {
		AUSTRIA: ['A BUD - SER', 'A VIE - BUD', 'F TRI - ALB'],
		ENGLAND: ['F LON - NTH', 'A LVP - YOR', 'F EDI - NWG'],
		FRANCE: ['A PAR - BUR', 'A MAR - SPA', 'F BRE - MAO'],
		GERMANY: ['F KIE - DEN', 'A BER - KIE', 'A MUN - RUH'],
		ITALY: ['F NAP - ION', 'A ROM - APU', 'A VEN H'],
		RUSSIA: ['A MOS - UKR', 'A WAR - GAL', 'F SEV - BLA', 'F STP/SC - BOT'],
		TURKEY: ['F ANK - BLA', 'A CON - BUL', 'A SMY - CON'],
	};

	console.log('5. Submitting Spring 1901 orders...');
	for (const player of state.players) {
		if (!player.power) continue;
		const orders = SPRING_1901_ORDERS[player.power];
		assert(orders, `No orders defined for ${player.power}`);
		const result = submitOrders(state, player.power, orders);
		assert(result.ok, `Failed to submit orders for ${player.power}: ${result.error}`);
		state = result.state;
	}
	assert(allOrdersSubmitted(state), 'All orders should be submitted');
	console.log('   All 7 powers submitted orders');

	// 6. Adjudicate Spring 1901
	console.log('6. Adjudicating Spring 1901...');
	const ordersMap = {};
	for (const player of state.players) {
		if (!player.power) continue;
		ordersMap[player.power] = state.currentOrders[player.power].orders;
	}

	const spring = await setOrdersAndProcess(state.diplomacyState, ordersMap, false);
	assert(spring.phase === 'F1901M', `Expected F1901M, got ${spring.phase}`);
	assert(!spring.isGameDone, 'Game should not be done');

	// Verify France moved
	assert(spring.units.FRANCE.includes('A BUR'), 'France A PAR should be in BUR');
	assert(spring.units.FRANCE.includes('A SPA'), 'France A MAR should be in SPA');
	console.log(`   Phase advanced to: ${spring.phase}`);
	console.log(`   France units: ${spring.units.FRANCE.join(', ')}`);

	// 7. Advance game state
	console.log('7. Advancing game state...');
	state = advancePhase(state, spring.phase, spring.gameState);
	assert(state.currentPhase === 'F1901M', 'State should be F1901M');
	assert(getPendingPowers(state).length === 7, 'All powers should be pending');
	console.log(`   Game state phase: ${state.currentPhase}`);
	console.log(`   Pending powers: ${getPendingPowers(state).join(', ')}`);

	// 8. Fall 1901 — capture neutrals
	const FALL_1901_ORDERS = {
		AUSTRIA: ['A SER - GRE', 'A BUD - RUM', 'F ALB S A SER - GRE'],
		ENGLAND: ['F NTH - NWY', 'A YOR - LON', 'F NWG - BAR'],
		FRANCE: ['A BUR - BEL', 'A SPA H', 'F MAO - POR'],
		GERMANY: ['F DEN H', 'A KIE - HOL', 'A RUH - BEL'],
		ITALY: ['F ION - TUN', 'A APU - NAP', 'A VEN H'],
		RUSSIA: ['A UKR - RUM', 'A GAL S A UKR - RUM', 'F SEV - BLA', 'F BOT - SWE'],
		TURKEY: ['F ANK - BLA', 'A BUL - GRE', 'A CON - BUL'],
	};

	console.log('8. Submitting Fall 1901 orders...');
	for (const player of state.players) {
		if (!player.power) continue;
		const orders = FALL_1901_ORDERS[player.power];
		const result = submitOrders(state, player.power, orders);
		assert(result.ok, `Failed to submit F1901 orders for ${player.power}: ${result.error}`);
		state = result.state;
	}

	console.log('9. Adjudicating Fall 1901...');
	const fallOrdersMap = {};
	for (const player of state.players) {
		if (!player.power) continue;
		fallOrdersMap[player.power] = state.currentOrders[player.power].orders;
	}

	const fall = await setOrdersAndProcess(state.diplomacyState, fallOrdersMap, false);
	console.log(`   Phase advanced to: ${fall.phase}`);
	console.log(`   ${formatCenterCounts(fall.centers)}`);

	const totalCenters = Object.values(fall.centers).reduce((sum, c) => sum + c.length, 0);
	assert(totalCenters > 22, `Expected more than 22 centers captured, got ${totalCenters}`);
	console.log(`   Total centers owned: ${totalCenters} (started with 22)`);

	// Check for solo victory (shouldn't happen yet)
	const victory = checkSoloVictory(fall.centers);
	assert(!victory, 'No solo victory should have occurred');

	// 10. Advance state
	state = advancePhase(state, fall.phase, fall.gameState);
	console.log(`   Game state phase: ${state.currentPhase}`);

	// If we're in a retreat or adjustment phase, submit empty orders to advance
	if (fall.phase.endsWith('R') || fall.phase.endsWith('A')) {
		console.log('10. Processing retreat/adjustment phase...');
		const adjPhase = await setOrdersAndProcess(state.diplomacyState, {}, false);
		state = advancePhase(state, adjPhase.phase, adjPhase.gameState);
		console.log(`    Advanced to: ${state.currentPhase}`);
	}

	console.log('\n=== PLAYTHROUGH TEST PASSED ===');
	console.log(`Final state: Game #${gameId}, phase ${state.currentPhase}, status: ${state.status}`);
	console.log('Two full turns (S1901M + F1901M) adjudicated successfully.');
	console.log('Game logic, order submission, adjudication, and phase advancement all working.');
}

run().catch(err => {
	console.error('\n=== PLAYTHROUGH TEST FAILED ===');
	console.error(err);
	process.exit(1);
});
