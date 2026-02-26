/** Static FAQ page served at /faq */

export const FAQ_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YourStaunchAlly — Diplomacy on Bluesky</title>
<style>
  :root { --bg: #0d1117; --fg: #e6edf3; --accent: #d4a84b; --dim: #8b949e; --card: #161b22; --border: #30363d; --navy: #1c2541; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem 1rem; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
  h1 span { color: var(--dim); font-weight: normal; font-size: 1rem; }
  h2 { color: var(--accent); font-size: 1.2rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  p, li { color: var(--fg); margin-bottom: 0.5rem; }
  ul { padding-left: 1.5rem; }
  code { background: var(--card); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; color: var(--accent); }
  .power { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1rem; margin: 0.5rem 0; }
  .power strong { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  th, td { border: 1px solid var(--border); padding: 0.4rem 0.8rem; text-align: left; }
  th { background: var(--card); color: var(--accent); }
  a { color: var(--accent); }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--dim); font-size: 0.85rem; }
</style>
</head>
<body>

<h1>📜 YourStaunchAlly <span>Diplomacy on Bluesky</span></h1>

<p>An automated <a href="https://en.wikipedia.org/wiki/Diplomacy_(game)">Diplomacy</a> bot for Bluesky. The classic 7-player strategy game of alliances and betrayal — negotiate publicly, submit orders privately.</p>

<h2>Quick Start</h2>
<ul>
  <li>Mention <code>@yourstalwartally.bsky.social new game</code> to create a game</li>
  <li>Friends mention <code>@yourstalwartally.bsky.social join #id</code> to join</li>
  <li>Creator mentions <code>@yourstalwartally.bsky.social start #id</code> (2-7 players)</li>
  <li>Check your DMs for your power assignment</li>
  <li>Submit orders via DM: <code>#id A PAR - BUR; F BRE - MAO</code></li>
</ul>

<h2>How a Game Works</h2>
<p>Diplomacy is a negotiation game set in pre-WWI Europe. Seven great powers compete for control of the continent. There are no dice — success depends entirely on negotiation and coordination with other players.</p>
<ul>
  <li><strong>Negotiate</strong> — Talk in the game thread, in DMs, wherever you want. Public negotiation is encouraged but not required.</li>
  <li><strong>Order</strong> — Each turn, privately DM your orders to the bot. All orders are revealed simultaneously.</li>
  <li><strong>Adjudicate</strong> — The bot resolves all moves at once. Supports beat single units; conflicts without support bounce.</li>
  <li><strong>Win</strong> — Control 18 of the 34 supply centers for a solo victory, or all remaining players can vote for a draw.</li>
</ul>

<h2>Phases</h2>
<table>
  <tr><th>Phase</th><th>Deadline</th><th>What happens</th></tr>
  <tr><td>Movement (Spring/Fall)</td><td>48 hours</td><td>Units move, hold, support, or convoy</td></tr>
  <tr><td>Retreat</td><td>24 hours</td><td>Dislodged units retreat or disband</td></tr>
  <tr><td>Build (Fall only)</td><td>24 hours</td><td>Build new units in home centers or disband excess</td></tr>
</table>
<p>Phases advance early when all players have submitted orders (with a 20-minute grace period to revise). All deadlines are in <strong>UTC</strong>.</p>

<h2>The Seven Powers</h2>

<div class="power"><strong>Austria</strong> — Central position, must negotiate early or be crushed. Natural early ally with Italy or Russia.</div>
<div class="power"><strong>England</strong> — Island fortress. Strong navy, slow to project power on land. Usually allies with France or Germany.</div>
<div class="power"><strong>France</strong> — Strong corner position with room to grow. Can go east or take on England.</div>
<div class="power"><strong>Germany</strong> — Central and vulnerable, but powerful if alliances hold. Kingmaker potential.</div>
<div class="power"><strong>Italy</strong> — Slow start but flexible. Can strike east or west. The "jackal" — often waits for an opening.</div>
<div class="power"><strong>Russia</strong> — Largest starting position, enemies on all sides. Needs friends fast.</div>
<div class="power"><strong>Turkey</strong> — Strong defensive corner. Slow to expand but very hard to eliminate.</div>

<h2>Mention Commands</h2>
<p>All public commands are mentions of <code>@yourstalwartally.bsky.social</code>:</p>
<ul>
  <li><code>new game</code> — Create a game (you auto-join)</li>
  <li><code>join #id</code> — Join an open game</li>
  <li><code>start #id</code> — Start the game (creator only, 2-7 players)</li>
  <li><code>status #id</code> — Current phase, center counts, deadlines</li>
  <li><code>games</code> — List all active games</li>
  <li><code>draw #id</code> — Vote for a draw</li>
  <li><code>claim #id POWER</code> — Take an unassigned power mid-game</li>
  <li><code>abandon #id</code> — Cancel a game (creator only, lobby phase)</li>
  <li><code>help</code> — Command reference</li>
</ul>

<h2>DM Commands</h2>
<p>Send direct messages to <code>@yourstalwartally.bsky.social</code>:</p>
<ul>
  <li><code>#id A PAR - BUR; F BRE - MAO; A MAR S A PAR - BUR</code> — Submit orders</li>
  <li><code>#id possible</code> — See all legal orders for your units</li>
  <li><code>#id orders</code> — Review your submitted orders</li>
  <li><code>my games</code> — List your active games with order status</li>
</ul>

<h2>Order Syntax</h2>
<table>
  <tr><th>Order</th><th>Syntax</th><th>Example</th></tr>
  <tr><td>Hold</td><td><code>UNIT H</code></td><td><code>A VEN H</code></td></tr>
  <tr><td>Move</td><td><code>UNIT - DEST</code></td><td><code>A PAR - BUR</code></td></tr>
  <tr><td>Support</td><td><code>UNIT S UNIT - DEST</code></td><td><code>A MAR S A PAR - BUR</code></td></tr>
  <tr><td>Support hold</td><td><code>UNIT S UNIT</code></td><td><code>F GOL S A MAR</code></td></tr>
  <tr><td>Convoy</td><td><code>F SEA C A FROM - TO</code></td><td><code>F MAO C A BRE - SPA</code></td></tr>
  <tr><td>Retreat</td><td><code>UNIT R DEST</code></td><td><code>A BUR R PAR</code></td></tr>
  <tr><td>Disband</td><td><code>UNIT D</code></td><td><code>A BUR D</code></td></tr>
  <tr><td>Build</td><td><code>BUILD UNIT LOC</code></td><td><code>BUILD F LON</code></td></tr>
  <tr><td>Waive</td><td><code>WAIVE</code> or <code>WAIVE N</code></td><td><code>WAIVE 2</code> (skip 2 builds)</td></tr>
</table>
<p>Separate multiple orders with semicolons, commas, or newlines. Prefix every order with the game ID.</p>
<p><strong>Partial updates:</strong> You can update orders for specific units without resubmitting everything. Send just the orders you want to change — existing orders for other units are kept. After each submission, the bot confirms your full current order set.</p>
<p><strong>Coastal provinces:</strong> Spain, Bulgaria, and St. Petersburg have multiple coasts. Fleet moves to these provinces require a coast (e.g., <code>F MAO - SPA/NC</code>). When the coast is unambiguous — e.g., <code>F GAS - SPA</code> can only reach the north coast — the bot infers it automatically. Use <code>#id possible</code> to see the exact syntax for your options.</p>

<h2>Important Notes</h2>
<ul>
  <li><strong>Follow the bot</strong> — You must follow @yourstalwartally.bsky.social or it can't DM you roles and results.</li>
  <li><strong>Orders are private</strong> — Only you can see your submitted orders until adjudication.</li>
  <li><strong>Communication is unregulated</strong> — Negotiate however you want: game threads, Bluesky DMs, Discord, group chats, carrier pigeon. The bot cannot and will not police how players talk to each other. Public negotiation in threads is encouraged because it makes the game more fun to follow, but private channels are completely fair game.</li>
  <li><strong>Civil disorder</strong> — Unassigned powers (in games with fewer than 7 players) hold all units and never build.</li>
  <li><strong>Multiple games</strong> — You can play in several games at once. Use the game ID to keep them straight.</li>
  <li><strong>Game feeds</strong> — Each game gets its own Bluesky feed with all announcements and results.</li>
</ul>

<h2>Tips for New Players</h2>
<ul>
  <li>You cannot win Diplomacy alone. Every power needs at least one ally to survive the opening.</li>
  <li>Talk to everyone. Even if you're planning to attack someone, keep the conversation going.</li>
  <li>Support is the core mechanic. Two units supporting an attack will beat one defender every time.</li>
  <li>Watch the supply center count. The player closest to 18 is everyone's enemy.</li>
  <li>Betrayal is part of the game — but time it well. Betray too early and no one will work with you.</li>
</ul>

<footer>
  <p>YourStaunchAlly is open source: <a href="https://github.com/PropterMalone/yourstaunchally">github.com/PropterMalone/yourstaunchally</a></p>
  <p>Run by <a href="https://bsky.app/profile/proptermalone.bsky.social">@proptermalone.bsky.social</a></p>
</footer>

</body>
</html>`;
