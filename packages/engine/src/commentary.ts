/**
 * Flavor text and commentary for game events.
 * Adds personality to bot posts — ironic, dramatic, and thematic.
 * Named after the bot's ironic title: "Your Staunch Ally" in a game about betrayal.
 *
 * Tone: wry, historical, dramatic. Plays into national themes without stereotyping.
 * Think war correspondent meets sardonic historian.
 */
import type { Power } from '@yourstaunchally/shared';

/** Pick a random element from an array */
function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)] as T;
}

// =============================================================================
// GAME START
// =============================================================================

const GAME_START_FLAVOR = [
	'The year is 1901. Europe holds its breath.',
	'Seven powers eye each other across the continent. May the best liar win.',
	'The Great Powers assemble. Alliances will be forged — and broken.',
	'Diplomacy begins. Trust no one. Especially your staunch ally.',
	'The board is set. The telegrams are flying. Let the backstabbing commence.',
	'Europe, 1901. Every handshake hides a knife.',
	'Seven nations. Thirty-four supply centers. One winner. Good luck.',
	'The game begins. Remember: in Diplomacy, "I promise" means nothing.',
	'The ambassadors take their seats. The smiles are warm. The daggers are sharp.',
	'A new chapter in European history begins. It will not end well for everyone.',
	'The map of Europe awaits its new masters. Who will rewrite the borders?',
	'Mobilization orders are signed. The Great War for supply centers begins.',
] as const;

export function gameStartCommentary(): string {
	return pick(GAME_START_FLAVOR);
}

// =============================================================================
// POWER ASSIGNMENTS
// =============================================================================

const POWER_FLAVOR: Record<Power, readonly string[]> = {
	AUSTRIA: [
		'The Dual Monarchy stands at the crossroads of Europe. Surrounded? Or centrally positioned? Perspective is everything.',
		'Austria — where "I just need one friend" is the national motto.',
		'The Habsburgs take their seat. History suggests this ends poorly, but hope springs eternal.',
		'Vienna, city of waltzes and frantic diplomacy. Your survival depends on the first conversation.',
		'Austria-Hungary: two names, one throne, zero margin for error.',
		'The empire of compromise. Can you talk faster than your neighbors can march?',
	],
	ENGLAND: [
		"Rule Britannia! The Channel is your moat, but you'll need to leave the island eventually.",
		'England starts safe behind the waves. The hard part is everything after 1901.',
		'The Royal Navy awaits orders. Shall we look north, or eye the continent?',
		'Splendid isolation is a fine opening. But islands do not win solo victories.',
		'The white cliffs of Dover have never been breached. Your opponents will try the long way around.',
		'Britannia rules the waves — now rule the land too, if you can.',
	],
	FRANCE: [
		'La Belle France — a corner position with room to grow, if you can keep friends on both borders.',
		"France starts strong. The question isn't if you'll expand, but which neighbor you'll eat first.",
		'Vive la France! Three units, two coastlines, one existential choice: east or west?',
		'Paris is lovely this time of year. So is Iberia. So is Belgium. Decisions, decisions.',
		"France: Europe's most comfortable corner. Don't get too comfortable.",
		'The tricolore flies over three supply centers. Make it eighteen.',
	],
	GERMANY: [
		'The Kaiser surveys the map. Enemies everywhere, but also... opportunities everywhere.',
		'Germany — the most powerful nation that somehow still feels surrounded.',
		'Central powers, central problems. Germany needs friends fast and enemies slow.',
		'Berlin sits at the heart of Europe. That means everyone can reach you — and you can reach everyone.',
		'Two fronts, three units, infinite anxiety. Welcome to Germany.',
		'The Fatherland has industrial might but geographic nightmares. Choose your allies wisely.',
	],
	ITALY: [
		'Italy — the boot that kicks. Eventually. Give it a few turns.',
		'The Risorgimento is complete. Now comes the hard part: actually doing something with it.',
		'Italy starts slow but flexible. The jackal waits for an opening.',
		'Rome gazes east and west. The Mediterranean beckons, but so does the Alps.',
		"Italy: the power that everyone forgets about until it's too late.",
		'Three units, a peninsula, and a dream. The boot will march — but which direction?',
	],
	RUSSIA: [
		'The Bear awakens. Four units, four fronts. Russia has the most of everything — including problems.',
		'Mother Russia — vast, powerful, and slightly overwhelmed by the number of borders to defend.',
		'The Tsar commands the largest army. Unfortunately, so does everyone else combined.',
		'From Warsaw to Sevastopol, the Russian frontier stretches endlessly. So do the threats.',
		'Four units! Luxury! Also: four fronts. The math is not as favorable as it looks.',
		'Russia: the only power that can threaten everyone and be threatened by everyone simultaneously.',
	],
	TURKEY: [
		'The Sultan surveys his domain. The corner is secure. Now to escape it.',
		'Turkey — the cockroach of Diplomacy. Nearly impossible to kill, frustratingly slow to win.',
		'The Ottoman Empire endures. Defense is easy; the question is whether you can break out.',
		'Constantinople stands at the crossroads of continents. The Sick Man of Europe has a healthy appetite.',
		'The Bosphorus is yours. The Black Sea is yours. Now take something that matters.',
		'Turkey: the corner fortress. Your walls are strong. Your expansion routes are... limited.',
	],
};

export function powerAssignmentCommentary(power: Power): string {
	return pick(POWER_FLAVOR[power]);
}

// =============================================================================
// PHASE RESULTS
// =============================================================================

const PHASE_MOVEMENT_FLAVOR = [
	'The orders are in. The map shifts.',
	'Armies march, fleets sail. Some find open doors; others find cold steel.',
	'Another season of promises kept and promises broken.',
	'The fog of war lifts, revealing the true state of affairs.',
	'Moves resolved. Some plans worked. Some very much did not.',
	'The couriers have delivered their messages. The results speak for themselves.',
	'Borders redrawn. Trust recalibrated. The game continues.',
	'The dust settles on another season of maneuvering.',
	'Orders executed. Alliances tested. Some held. Some crumbled.',
	'The telegrams were sent, the armies moved, and someone is already composing an angry message.',
	'Spring/Fall has come and gone. The map tells the story.',
	"Promises were made. Were they kept? Check the map and you'll know.",
] as const;

const PHASE_RETREAT_FLAVOR = [
	'Dislodged units scramble for safety.',
	'The defeated must choose: retreat or disband. Neither feels good.',
	'Time to find a new home for those displaced armies.',
	"The retreat phase: where yesterday's ambitions become today's evacuations.",
	'Dislodged forces fall back. Regrouping is generous; surviving is more like it.',
	'Retreat orders due. The map is not kind to the displaced.',
] as const;

const PHASE_BUILD_FLAVOR = [
	'Winter arrives. Time to count your supply centers and make hard choices.',
	'The build phase — where gains become armies and losses become painful.',
	'New units emerge in home centers. The balance of power shifts.',
	'Winter council: who builds, who disbands, and who regrets their autumn.',
	'The spoils of war materialize as fresh units. The costs materialize as disbanded ones.',
	"Snowfall across Europe. In war rooms, generals argue over which units live and which don't.",
	'Build or disband? The cruelest question in Diplomacy.',
	"Winter is here. Count your centers. Count your enemies. They're often the same people.",
] as const;

export function phaseCommentary(phaseType: 'M' | 'R' | 'A'): string {
	if (phaseType === 'M') return pick(PHASE_MOVEMENT_FLAVOR);
	if (phaseType === 'R') return pick(PHASE_RETREAT_FLAVOR);
	return pick(PHASE_BUILD_FLAVOR);
}

// =============================================================================
// TERRITORY CAPTURE — province-specific flavor when a power takes a notable SC
// =============================================================================

/** Notable supply center flavor — keyed by province abbreviation */
const TERRITORY_FLAVOR: Record<string, readonly string[]> = {
	// Neutral SCs
	BEL: [
		'Belgium changes hands. As is tradition.',
		'The crossroads of Europe falls to a new master.',
		'Belgium: strategically vital, perpetually contested.',
	],
	BUL: [
		'Bulgaria falls — the Balkans shift once more.',
		'Sofia under new management. The Balkan powder keg sparks again.',
	],
	DEN: [
		'Denmark secured. The Baltic narrows.',
		'Copenhagen falls. Control of the straits follows.',
	],
	GRE: [
		'Greece falls. The cradle of democracy, occupied by force.',
		'Athens taken. The Aegean is no longer neutral waters.',
	],
	HOL: [
		'Holland falls. The dykes hold; the army did not.',
		'The Dutch trading empire has a new proprietor.',
	],
	NWY: [
		'Norway falls. The fjords echo with the march of foreign boots.',
		'Oslo secured. Scandinavia trembles.',
	],
	POR: [
		'Portugal conquered — the western edge of Europe changes hands.',
		'Lisbon falls. The Atlantic coast has a new ruler.',
	],
	RUM: [
		'Romania falls. The Danube runs through new territory now.',
		'Bucharest changes flags. The oil fields have a new master.',
	],
	SER: [
		'Serbia falls — a spark in the Balkans, as always.',
		'Belgrade taken. The crossroads of the south secured.',
	],
	SPA: [
		'Spain falls! The Iberian Peninsula bows to a new power.',
		'Madrid conquered. The Pyrenees were not enough.',
	],
	SWE: [
		'Sweden falls. The Scandinavian balance tips.',
		'Stockholm under occupation. The northern flank is secure.',
	],
	TUN: [
		'Tunis seized. The North African coast is contested.',
		'Tunisia falls — the Mediterranean balance shifts southward.',
	],

	// Home SCs — capturing these is dramatic
	BER: [
		'Berlin falls! The German heartland is breached!',
		'Berlin captured — a catastrophe for the Kaiser.',
	],
	BRE: [
		'Brest taken! The Atlantic gateway is lost to France.',
		'Brest falls. French naval power takes a devastating blow.',
	],
	BUD: [
		'Budapest falls! The Dual Monarchy fractures.',
		'Budapest captured — Austria-Hungary reels.',
	],
	CON: [
		'Constantinople falls! The Ottoman capital is lost!',
		'The jewel of the Bosphorus changes hands. A historic blow.',
	],
	EDI: [
		'Edinburgh falls! Scotland under foreign occupation.',
		'Edinburgh taken — the British Isles are no longer safe.',
	],
	KIE: [
		'Kiel captured! German naval power is crippled.',
		'Kiel falls — the North Sea corridor is breached.',
	],
	LON: [
		'London falls! The unthinkable has happened!',
		'London captured! Britannia no longer rules anything.',
	],
	LVP: [
		'Liverpool taken! England loses its western anchor.',
		'Liverpool falls. The Irish Sea is no longer British.',
	],
	MAR: [
		'Marseilles falls! Southern France is breached.',
		'Marseilles captured — the Mediterranean door swings open.',
	],
	MOS: [
		'Moscow falls! The Russian heartland is pierced!',
		"Moscow captured — Napoleon couldn't, but someone just did.",
	],
	MUN: ['Munich falls! Bavaria is lost.', 'Munich captured — the southern German front collapses.'],
	NAP: ['Naples falls! Southern Italy is lost.', 'Naples captured — the boot is kicked.'],
	PAR: [
		'Paris falls! The City of Light goes dark.',
		'Paris captured! La France is wounded to the core.',
	],
	ROM: [
		'Rome falls! The Eternal City has a new emperor.',
		'Rome captured — all roads lead here, and the invaders took them.',
	],
	SEV: [
		'Sevastopol falls! The Black Sea fortress is breached.',
		'Sevastopol captured — Russian naval dominance in the south collapses.',
	],
	SMY: [
		'Smyrna falls! Turkish Anatolia is breached.',
		'Smyrna captured — the Ottoman flank crumbles.',
	],
	STP: [
		"St. Petersburg falls! Russia's northern jewel is taken.",
		'St. Petersburg captured — the window to Europe shatters.',
	],
	TRI: [
		'Trieste falls! The Adriatic port changes hands.',
		'Trieste captured — Austrian access to the sea is severed.',
	],
	VEN: [
		'Venice falls! The Queen of the Adriatic bows.',
		'Venice captured — the canals carry a new flag.',
	],
	VIE: [
		'Vienna falls! The Habsburg capital is lost!',
		'Vienna captured — the waltzes stop, the occupation begins.',
	],
	WAR: [
		'Warsaw falls! The Eastern Front collapses.',
		'Warsaw captured — Poland changes hands. Again.',
	],
	ANK: [
		'Ankara falls! The Turkish interior is pierced.',
		'Ankara captured — the heart of Anatolia stops beating Ottoman.',
	],
};

/** Generic capture flavor when no province-specific line exists */
const GENERIC_CAPTURE_FLAVOR = [
	'Another flag raised over another supply center.',
	'The map redraws itself once more.',
	'Territory changes hands — as it always does.',
	'A new conquest. A new enemy made.',
] as const;

/**
 * Generate commentary for a power capturing a specific supply center.
 * Returns province-specific flavor when available, generic otherwise.
 */
export function territoryCaptureCommentary(province: string): string {
	const lines = TERRITORY_FLAVOR[province];
	if (lines) return pick(lines);
	return pick(GENERIC_CAPTURE_FLAVOR);
}

// =============================================================================
// SUPPLY CENTER CHANGE SUMMARIES
// =============================================================================

const EXPANSION_FLAVOR = [
	'is expanding aggressively',
	'is on the march',
	'grows stronger',
	'extends its reach',
	'is building an empire',
	'claims new territory',
] as const;

const COLLAPSE_FLAVOR = [
	'is in serious trouble',
	'is hemorrhaging territory',
	'watches helplessly as the borders shrink',
	'is being carved up',
	'faces an existential crisis',
	'is on the back foot',
] as const;

const ELIMINATION_FLAVOR = [
	'has been eliminated! Another great power falls.',
	'is wiped from the map. So ends an empire.',
	'is no more. The vultures divide the remains.',
	'has been destroyed. Diplomacy is a cruel game.',
] as const;

export function centerChangeCommentary(
	power: Power,
	gained: string[],
	lost: string[],
): string | null {
	if (gained.length === 0 && lost.length === 0) return null;

	if (gained.length > 0 && lost.length === 0) {
		if (gained.length >= 3)
			return `${power} ${pick(EXPANSION_FLAVOR)} — ${gained.length} centers seized!`;
		const notable = gained.find((p) => TERRITORY_FLAVOR[p]);
		if (notable) return `${power}: +${gained.join(', ')}. ${territoryCaptureCommentary(notable)}`;
		return `${power} expands: +${gained.join(', ')}`;
	}

	if (gained.length === 0 && lost.length > 0) {
		if (lost.length >= 3) return `${power} ${pick(COLLAPSE_FLAVOR)} — ${lost.length} centers lost!`;
		return `${power} contracts: −${lost.join(', ')}`;
	}

	return `${power}: gained ${gained.join(', ')}, lost ${lost.join(', ')}`;
}

export function eliminationCommentary(power: Power): string {
	return `${power} ${pick(ELIMINATION_FLAVOR)}`;
}

// =============================================================================
// SOLO VICTORY
// =============================================================================

const SOLO_VICTORY_FLAVOR = [
	'utterly dominates the continent',
	'achieves total supremacy',
	'has conquered Europe',
	'stands alone atop the ruins of alliance',
	'proves that betrayal is, in fact, a winning strategy',
	'rewrites the map of Europe in their own image',
	'wins the game — and loses every friend they had',
	'claims the continent. The other six powers wonder where it all went wrong',
	'achieves the impossible — a solo victory in a game of seven',
] as const;

export function soloVictoryCommentary(power: Power): string {
	return `${power} ${pick(SOLO_VICTORY_FLAVOR)}!`;
}

// =============================================================================
// DRAW
// =============================================================================

const DRAW_FLAVOR = [
	'The surviving powers agree to share Europe. For now.',
	'Peace breaks out. The players decide that mutual destruction serves no one.',
	'A draw is declared. No one won, but everyone survived — and in Diplomacy, that counts.',
	'The great powers put down their swords. Whether this is wisdom or exhaustion, history will judge.',
	'The guns fall silent. Europe is divided, but stable. A draw.',
	'Stalemate recognized. The surviving powers carve up the continent at the conference table.',
	'Nobody won. But in Diplomacy, not losing is its own kind of victory.',
	'The Treaty is signed. The borders are set. The grudges will last forever.',
] as const;

export function drawCommentary(): string {
	return pick(DRAW_FLAVOR);
}

// =============================================================================
// DEADLINE / TIMING
// =============================================================================

const DEADLINE_WARNING_FLAVOR = [
	'The clock is ticking. Submit your orders or face civil disorder.',
	'Time runs short. Powers without orders will hold all units.',
	'Final hours. Get your orders in or your armies stand idle.',
	"The deadline approaches. Silence will be interpreted as 'hold everything.'",
	'Hours remain. Your units await instructions.',
] as const;

export function deadlineWarningCommentary(): string {
	return pick(DEADLINE_WARNING_FLAVOR);
}

const ALL_ORDERS_IN_FLAVOR = [
	'All orders received — resolving immediately!',
	"Every power has spoken. Let's see what happens.",
	'All in. The die is cast.',
	'Orders locked. Adjudicating now.',
	'All seven powers have submitted. No waiting — the season resolves now.',
	'The last courier arrives. Time to see who kept their promises.',
] as const;

export function allOrdersInCommentary(): string {
	return pick(ALL_ORDERS_IN_FLAVOR);
}

// =============================================================================
// ILLEGAL ORDERS
// =============================================================================

const ILLEGAL_ORDER_FLAVOR = [
	'Your generals look at this order, look at the map, and look at each other in confusion.',
	'A bold strategy. Unfortunately, also an impossible one.',
	'Your admirals report that this order violates the laws of physics. And geography.',
	'The war room erupts in argument. This order cannot be carried out.',
	'Your couriers tried to deliver this order, but the army had no idea what to do with it.',
	"Even your staunchest ally couldn't execute this order. It's not legal.",
	'The generals nod politely, then quietly hold position. This order makes no sense to them.',
	'An ambitious command. Sadly, the units in question cannot comply.',
	'Your staff officers gently suggest consulting the map before issuing further orders.',
	"This order has been filed under 'creative but impossible.'",
] as const;

const ILLEGAL_ORDER_SINGLE_FLAVOR = [
	'Your generals squint at this order and quietly hold position instead.',
	'The unit reads this order, shrugs, and stays put.',
	"A creative interpretation of military strategy. Unfortunately, it's not legal.",
	'This order confuses even the most experienced staff officers.',
	'Filed under "ambitious but impossible." The unit holds.',
] as const;

/** Commentary for when some orders in a submission are illegal */
export function illegalOrderCommentary(illegalCount: number, totalCount: number): string {
	if (illegalCount === totalCount) {
		return `⚠️ None of your ${totalCount} orders are legal! ${pick(ILLEGAL_ORDER_FLAVOR)} All units will hold. DM "#id possible" to see valid orders.`;
	}
	if (illegalCount === 1) {
		return `⚠️ 1 of ${totalCount} orders is not legal. ${pick(ILLEGAL_ORDER_SINGLE_FLAVOR)} DM "#id possible" to check.`;
	}
	return `⚠️ ${illegalCount} of ${totalCount} orders are not legal. ${pick(ILLEGAL_ORDER_FLAVOR)} DM "#id possible" to check.`;
}

/** Per-order annotation for illegal orders */
export function illegalOrderAnnotation(order: string): string {
	return `  ❌ ${order} — not a legal order`;
}

/** Per-order annotation for legal orders */
export function legalOrderAnnotation(order: string): string {
	return `  ✓ ${order}`;
}

// =============================================================================
// YEAR PROGRESSION — commentary that changes as the game ages
// =============================================================================

export function yearCommentary(year: number): string | null {
	if (year === 1901) return null; // Opening year, no special comment
	if (year === 1902)
		return pick([
			'The opening moves are over. Now the real game begins.',
			'Year two — alliances solidify or shatter.',
		]);
	if (year === 1903)
		return pick([
			'The midgame approaches. The map is taking shape.',
			'1903 — by now, everyone knows who their enemies are.',
		]);
	if (year === 1904)
		return pick([
			'Four years in. The weak are dying, the strong are growing.',
			'The board is thinning. Every move matters more.',
		]);
	if (year === 1905)
		return pick([
			'Half a decade of war. Europe is unrecognizable.',
			'1905 — the endgame is in sight for someone.',
		]);
	if (year >= 1906 && year <= 1908)
		return pick([
			'The long game. Stamina and cunning matter more than opening position.',
			'A grinding war of attrition.',
			'The marathon continues.',
		]);
	if (year >= 1909)
		return pick([
			'An epic game. The historians will write about this one.',
			'The war drags on. Europe bleeds.',
			'A generational conflict. Who will outlast whom?',
		]);
	return null;
}

// =============================================================================
// STAB DETECTION — when a power attacks a neighbor it was previously cooperating with
// =============================================================================

const BETRAYAL_FLAVOR = [
	'calls it "strategic repositioning." Everyone else calls it a stab.',
	'demonstrates why "Your Staunch Ally" is an ironic name.',
	"reveals that this season's promises had an expiration date.",
	'sends a clear message: alliances are temporary.',
	'makes a bold move. Former friends take note.',
	'redefines the relationship. Dramatically.',
] as const;

export function betrayalCommentary(attacker: Power, defender: Power): string {
	return `${attacker} ${pick(BETRAYAL_FLAVOR)} ${defender} scrambles to respond.`;
}

// =============================================================================
// NEAR VICTORY — when someone is close to 18 centers
// =============================================================================

export function nearVictoryCommentary(power: Power, centers: number): string | null {
	if (centers >= 17)
		return `${power} stands at ${centers} centers — one away from victory! Can the others stop them?`;
	if (centers >= 15)
		return `${power} has ${centers} centers and is closing in on victory. The clock is ticking for everyone else.`;
	if (centers >= 13)
		return `${power} leads with ${centers} centers. The balance of power demands a coalition.`;
	return null;
}
