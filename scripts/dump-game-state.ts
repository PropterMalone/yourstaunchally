import Database from 'better-sqlite3';
const db = new Database('/home/karl/Projects/yourstaunchally/data/yourstaunchally.db', { readonly: true });
const row = db.prepare("SELECT state_json FROM games WHERE game_id = 'uetpue'").get() as any;
const state = JSON.parse(row.state_json);
console.log(JSON.stringify(state, null, 2));
