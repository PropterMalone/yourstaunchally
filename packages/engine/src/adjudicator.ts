/**
 * TypeScript wrapper around the Python diplomacy adjudication bridge.
 * Calls scripts/adjudicate.py as a subprocess with JSON on stdin/stdout.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Power } from '@yourfriend/shared';

const execFileAsync = promisify(execFile);

/** Path to the Python script — resolved relative to project root */
const SCRIPT_PATH = resolve(import.meta.dirname, '../../../scripts/adjudicate.py');

/** Python executable — configurable via env for Docker/venv */
const PYTHON_PATH = process.env['PYTHON_PATH'] ?? 'python3';

interface AdjudicatorResponse {
	ok: boolean;
	result?: Record<string, unknown>;
	error?: string;
}

/** Call the Python adjudicator subprocess */
async function callAdjudicator(request: Record<string, unknown>): Promise<Record<string, unknown>> {
	const input = JSON.stringify(request);

	const { stdout, stderr } = await execFileAsync(PYTHON_PATH, [SCRIPT_PATH], {
		input,
		maxBuffer: 10 * 1024 * 1024, // 10MB for SVG maps
		timeout: 30_000,
	});

	if (stderr) {
		console.warn('[adjudicator stderr]', stderr);
	}

	const response = JSON.parse(stdout) as AdjudicatorResponse;
	if (!response.ok) {
		throw new Error(`Adjudicator error: ${response.error ?? 'unknown'}`);
	}

	return response.result ?? {};
}

/** Create a new standard Diplomacy game */
export async function newGame(): Promise<{
	gameState: unknown;
	phase: string;
	units: Record<Power, string[]>;
	centers: Record<Power, string[]>;
}> {
	const result = await callAdjudicator({ op: 'new_game' });
	return {
		gameState: result['game_state'],
		phase: result['phase'] as string,
		units: result['units'] as Record<Power, string[]>,
		centers: result['centers'] as Record<Power, string[]>,
	};
}

/** Set orders for powers and process (adjudicate) the current phase */
export async function setOrdersAndProcess(
	gameState: unknown,
	orders: Record<string, string[]>,
	render = false,
): Promise<{
	gameState: unknown;
	phase: string;
	units: Record<Power, string[]>;
	centers: Record<Power, string[]>;
	isGameDone: boolean;
	svg?: string;
}> {
	const result = await callAdjudicator({
		op: 'set_orders_and_process',
		game_state: gameState,
		orders,
		render,
	});
	return {
		gameState: result['game_state'],
		phase: result['phase'] as string,
		units: result['units'] as Record<Power, string[]>,
		centers: result['centers'] as Record<Power, string[]>,
		isGameDone: result['is_game_done'] as boolean,
		svg: result['svg'] as string | undefined,
	};
}

/** Get all possible orders for the current phase, organized by power */
export async function getPossibleOrders(gameState: unknown): Promise<{
	phase: string;
	possibleOrders: Record<Power, Record<string, string[]>>;
}> {
	const result = await callAdjudicator({
		op: 'get_possible',
		game_state: gameState,
	});
	return {
		phase: result['phase'] as string,
		possibleOrders: result['possible_orders'] as Record<Power, Record<string, string[]>>,
	};
}

/** Render the current game state as SVG */
export async function renderMap(gameState: unknown): Promise<{ svg: string; phase: string }> {
	const result = await callAdjudicator({
		op: 'render_map',
		game_state: gameState,
	});
	return {
		svg: result['svg'] as string,
		phase: result['phase'] as string,
	};
}
