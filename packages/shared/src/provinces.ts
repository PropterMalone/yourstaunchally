/**
 * Static province data for the standard Diplomacy map.
 * 75 provinces total: 34 land, 19 coastal, 22 sea.
 * 34 supply centers.
 *
 * Province abbreviations match the Python diplomacy library exactly.
 * Adjacency data is NOT duplicated here — the Python library handles that.
 * This file provides display names and SC ownership for the TypeScript side.
 */
import type { Power } from './types.js';

export interface ProvinceInfo {
	abbreviation: string;
	name: string;
	isSupplyCenter: boolean;
	/** Starting owner (null = neutral SC or non-SC) */
	startingOwner: Power | null;
	type: 'land' | 'coast' | 'sea';
}

/** All 34 supply centers and their starting owners */
export const SUPPLY_CENTERS: Record<string, Power | null> = {
	// Austria (3)
	BUD: 'AUSTRIA',
	TRI: 'AUSTRIA',
	VIE: 'AUSTRIA',
	// England (3)
	EDI: 'ENGLAND',
	LON: 'ENGLAND',
	LVP: 'ENGLAND',
	// France (3)
	BRE: 'FRANCE',
	MAR: 'FRANCE',
	PAR: 'FRANCE',
	// Germany (3)
	BER: 'GERMANY',
	KIE: 'GERMANY',
	MUN: 'GERMANY',
	// Italy (3)
	NAP: 'ITALY',
	ROM: 'ITALY',
	VEN: 'ITALY',
	// Russia (4)
	MOS: 'RUSSIA',
	SEV: 'RUSSIA',
	STP: 'RUSSIA',
	WAR: 'RUSSIA',
	// Turkey (3)
	ANK: 'TURKEY',
	CON: 'TURKEY',
	SMY: 'TURKEY',
	// Neutral (13)
	BEL: null,
	BUL: null,
	DEN: null,
	GRE: null,
	HOL: null,
	NWY: null,
	POR: null,
	RUM: null,
	SER: null,
	SPA: null,
	SWE: null,
	TUN: null,
};

/** Starting units per power — matches diplomacy library's initial state */
export const STARTING_UNITS: Record<Power, string[]> = {
	AUSTRIA: ['A BUD', 'A VIE', 'F TRI'],
	ENGLAND: ['F EDI', 'F LON', 'A LVP'],
	FRANCE: ['F BRE', 'A MAR', 'A PAR'],
	GERMANY: ['F KIE', 'A BER', 'A MUN'],
	ITALY: ['F NAP', 'A ROM', 'A VEN'],
	RUSSIA: ['A MOS', 'A WAR', 'F SEV', 'F STP/SC'],
	TURKEY: ['F ANK', 'A CON', 'A SMY'],
};

/** Number of starting supply centers per power */
export const STARTING_CENTER_COUNTS: Record<Power, number> = {
	AUSTRIA: 3,
	ENGLAND: 3,
	FRANCE: 3,
	GERMANY: 3,
	ITALY: 3,
	RUSSIA: 4,
	TURKEY: 3,
};

/** Province display names — used for human-readable output */
export const PROVINCE_NAMES: Record<string, string> = {
	// Supply centers
	BUD: 'Budapest',
	TRI: 'Trieste',
	VIE: 'Vienna',
	EDI: 'Edinburgh',
	LON: 'London',
	LVP: 'Liverpool',
	BRE: 'Brest',
	MAR: 'Marseilles',
	PAR: 'Paris',
	BER: 'Berlin',
	KIE: 'Kiel',
	MUN: 'Munich',
	NAP: 'Naples',
	ROM: 'Rome',
	VEN: 'Venice',
	MOS: 'Moscow',
	SEV: 'Sevastopol',
	STP: 'St. Petersburg',
	WAR: 'Warsaw',
	ANK: 'Ankara',
	CON: 'Constantinople',
	SMY: 'Smyrna',
	BEL: 'Belgium',
	BUL: 'Bulgaria',
	DEN: 'Denmark',
	GRE: 'Greece',
	HOL: 'Holland',
	NWY: 'Norway',
	POR: 'Portugal',
	RUM: 'Rumania',
	SER: 'Serbia',
	SPA: 'Spain',
	SWE: 'Sweden',
	TUN: 'Tunis',
	// Non-SC land/coast provinces
	ALB: 'Albania',
	APU: 'Apulia',
	ARM: 'Armenia',
	BOH: 'Bohemia',
	BUR: 'Burgundy',
	CLY: 'Clyde',
	FIN: 'Finland',
	GAL: 'Galicia',
	GAS: 'Gascony',
	LVN: 'Livonia',
	NAF: 'North Africa',
	PIC: 'Picardy',
	PIE: 'Piedmont',
	PRU: 'Prussia',
	RUH: 'Ruhr',
	SIL: 'Silesia',
	SYR: 'Syria',
	TUS: 'Tuscany',
	TYR: 'Tyrolia',
	UKR: 'Ukraine',
	WAL: 'Wales',
	YOR: 'Yorkshire',
	// Sea provinces
	ADR: 'Adriatic Sea',
	AEG: 'Aegean Sea',
	BAL: 'Baltic Sea',
	BAR: 'Barents Sea',
	BLA: 'Black Sea',
	BOT: 'Gulf of Bothnia',
	EAS: 'Eastern Mediterranean',
	ENG: 'English Channel',
	GOL: 'Gulf of Lyon',
	HEL: 'Helgoland Bight',
	ION: 'Ionian Sea',
	IRI: 'Irish Sea',
	MAO: 'Mid-Atlantic Ocean',
	NAO: 'North Atlantic Ocean',
	NTH: 'North Sea',
	NWG: 'Norwegian Sea',
	SKA: 'Skagerrak',
	TYS: 'Tyrrhenian Sea',
	WES: 'Western Mediterranean',
};

/** Total supply centers on the standard map */
export const TOTAL_SUPPLY_CENTERS = 34;
