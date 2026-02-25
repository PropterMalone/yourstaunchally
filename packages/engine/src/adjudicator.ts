/**
 * TypeScript wrapper around the Python diplomacy adjudication bridge.
 * Calls scripts/adjudicate.py as a subprocess with JSON on stdin/stdout.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Power } from '@yourstaunchally/shared';

/** Path to the Python script — resolved relative to project root */
const SCRIPT_PATH = resolve(import.meta.dirname, '../../../scripts/adjudicate.py');

/** Python executable — read lazily so tests can set PYTHON_PATH before first call */
function getPythonPath(): string {
	return process.env['PYTHON_PATH'] ?? 'python3';
}

interface AdjudicatorResponse {
	ok: boolean;
	result?: Record<string, unknown>;
	error?: string;
}

/** Call the Python adjudicator subprocess */
async function callAdjudicator(request: Record<string, unknown>): Promise<Record<string, unknown>> {
	const input = JSON.stringify(request);

	return new Promise((resolveP, reject) => {
		const proc = spawn(getPythonPath(), [SCRIPT_PATH], {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 30_000,
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

		proc.on('error', (err) => reject(err));

		proc.on('close', (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString();
			const stderr = Buffer.concat(stderrChunks).toString();

			if (stderr) {
				console.warn('[adjudicator stderr]', stderr);
			}

			if (code !== 0) {
				reject(new Error(`Adjudicator exited with code ${code}: ${stderr || stdout}`));
				return;
			}

			try {
				// The Python diplomacy lib may print warnings to stdout before our JSON.
				// Strip everything before the first '{' to get clean JSON.
				const jsonStart = stdout.indexOf('{');
				const jsonStr = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;
				if (jsonStart > 0) {
					console.warn('[adjudicator stdout noise]', stdout.slice(0, jsonStart).trim());
				}

				const response = JSON.parse(jsonStr) as AdjudicatorResponse;
				if (!response.ok) {
					reject(new Error(`Adjudicator error: ${response.error ?? 'unknown'}`));
					return;
				}
				resolveP(response.result ?? {});
			} catch {
				reject(new Error(`Failed to parse adjudicator output: ${stdout.slice(0, 200)}`));
			}
		});

		// Write input and close stdin to signal EOF
		proc.stdin.write(input);
		proc.stdin.end();
	});
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
