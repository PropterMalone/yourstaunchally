/** One-time: remove zombie "#UETPUE A WAR H" from Russia's current orders */
import Database from 'better-sqlite3';
import type { GameState } from '@yourstaunchally/shared';

const db = new Database('./data/yourstaunchally.db');
const row = db.prepare("SELECT state_json FROM games WHERE game_id = 'uetpue'").get() as { state_json: string };
const state = JSON.parse(row.state_json) as GameState;

const russia = state.currentOrders['RUSSIA'];
if (russia) {
	const before = russia.orders.length;
	russia.orders = russia.orders.filter((o) => !o.startsWith('#'));
	const after = russia.orders.length;
	console.log(`Russia orders: ${before} → ${after}`);
	console.log('Current orders:', russia.orders);

	db.prepare("UPDATE games SET state_json = ? WHERE game_id = 'uetpue'").run(JSON.stringify(state));
	console.log('DB updated');
} else {
	console.log('No Russia orders found');
}
