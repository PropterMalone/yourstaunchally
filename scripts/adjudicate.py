#!/usr/bin/env python3
"""
Diplomacy adjudication bridge — stateless subprocess.

Accepts JSON on stdin, returns JSON on stdout.
Each call is independent: pass full game state in, get results out.

Operations:
  new_game          → Create a new standard game, return initial state
  set_orders        → Set orders for powers (without processing)
  process           → Process current phase (adjudicate), return new state
  get_possible      → Get possible orders for the current phase
  get_state         → Get current game state (units, centers, phase)
  render_map        → Render current state as SVG

Input format:
  { "op": "...", "game_state": {...}, "orders": {...}, "render": true }

Output format:
  { "ok": true, "result": {...} }
  { "ok": false, "error": "..." }
"""

import json
import re
import sys
from diplomacy import Game
from diplomacy.utils.export import to_saved_game_format, from_saved_game_format

POWERS_RE = r"austria|england|france|germany|italy|russia|turkey"


def strip_non_sc_coloring(svg, centers):
    """Replace power coloring with neutral fill for non-supply-center provinces.

    The diplomacy library colors every province a power has ever influenced.
    We only want supply centers colored. Each colored province is a single
    <path class="france" d="..." id="_xxx"/> element. For non-SC provinces
    we swap the power class for "nopower" (antiquewhite fill, defined in the
    SVG stylesheet).
    """
    all_scs = set()
    for power_centers in centers.values():
        all_scs.update(c.upper()[:3] for c in power_centers)

    def replace_match(match):
        path_text = match.group(0)
        id_match = re.search(r'id="(_[a-z_]+)"', path_text)
        if not id_match:
            return path_text  # can't determine province, keep it
        province = id_match.group(1).lstrip("_").upper()[:3]
        if province in all_scs:
            return path_text  # supply center, keep coloring
        # Non-SC: swap power class for neutral "nopower"
        return re.sub(r'class="(?:' + POWERS_RE + r')"', 'class="nopower"', path_text)

    # Match colored province paths (have power class, self-closing)
    pattern = re.compile(r'\s*<path\s+class="(?:' + POWERS_RE + r')"[^/]*/>')
    return pattern.sub(replace_match, svg)


def new_game():
    """Create a fresh standard Diplomacy game."""
    game = Game()
    saved = to_saved_game_format(game)
    return {
        "game_state": saved,
        "phase": game.get_current_phase(),
        "units": {name: game.get_units(name) for name in game.get_map_power_names()},
        "centers": {name: game.get_centers(name) for name in game.get_map_power_names()},
    }


def load_game(game_state):
    """Reconstruct a Game from saved state."""
    return from_saved_game_format(game_state)


def get_state(game):
    """Extract current state from a game."""
    return {
        "phase": game.get_current_phase(),
        "units": {name: game.get_units(name) for name in game.get_map_power_names()},
        "centers": {name: game.get_centers(name) for name in game.get_map_power_names()},
        "is_game_done": game.is_game_done,
    }


def set_orders_and_process(game, orders, render=False):
    """
    Set orders for specified powers and process the phase.

    orders: { "FRANCE": ["A PAR - BUR", ...], "ENGLAND": [...] }
    Powers not in orders dict will have their units hold (civil disorder).
    """
    for power_name, power_orders in orders.items():
        game.set_orders(power_name, power_orders)

    game.process()

    saved = to_saved_game_format(game)
    result = {
        "game_state": saved,
        **get_state(game),
    }

    # Extract order results from the just-processed phase (last in history before current)
    # saved['phases'] includes all completed phases; the most recently completed one is last
    completed_phases = [p for p in saved.get("phases", []) if p["name"] != game.get_current_phase()]
    if completed_phases:
        last_phase = completed_phases[-1]
        result["order_results"] = {
            "orders": last_phase.get("orders", {}),
            "results": last_phase.get("results", {}),
        }

    if render:
        svg = game.render(incl_abbrev=True)
        result["svg"] = strip_non_sc_coloring(svg, result["centers"])

    return result


def get_possible_orders(game):
    """Get all possible orders for the current phase, organized by power."""
    all_possible = game.get_all_possible_orders()
    by_power = {}

    for power_name in game.get_map_power_names():
        locs = game.get_orderable_locations(power_name)
        power_orders = {}
        for loc in locs:
            if loc in all_possible:
                power_orders[loc] = all_possible[loc]
        by_power[power_name] = power_orders

    return {
        "phase": game.get_current_phase(),
        "possible_orders": by_power,
    }


def render_map(game):
    """Render the current game state as SVG."""
    svg = game.render(incl_abbrev=True)
    centers = {name: game.get_centers(name) for name in game.get_map_power_names()}
    return {
        "svg": strip_non_sc_coloring(svg, centers),
        "phase": game.get_current_phase(),
    }


def main():
    try:
        raw = sys.stdin.read()
        request = json.loads(raw)
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"Invalid JSON: {e}"}, sys.stdout)
        return

    op = request.get("op")

    try:
        if op == "new_game":
            result = new_game()

        elif op in ("set_orders_and_process", "get_possible", "get_state", "render_map"):
            game_state = request.get("game_state")
            if not game_state:
                json.dump({"ok": False, "error": "Missing game_state"}, sys.stdout)
                return

            game = load_game(game_state)

            if op == "set_orders_and_process":
                orders = request.get("orders", {})
                render = request.get("render", False)
                result = set_orders_and_process(game, orders, render)
            elif op == "get_possible":
                result = get_possible_orders(game)
            elif op == "get_state":
                result = get_state(game)
            elif op == "render_map":
                result = render_map(game)
            else:
                result = None  # unreachable

        else:
            json.dump({"ok": False, "error": f"Unknown op: {op}"}, sys.stdout)
            return

        json.dump({"ok": True, "result": result}, sys.stdout)

    except Exception as e:
        json.dump({"ok": False, "error": f"{type(e).__name__}: {e}"}, sys.stdout)


if __name__ == "__main__":
    main()
