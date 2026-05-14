# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Home Sweet Home — Family Command Center** is a single-file static HTML dashboard (`household-manager_1.html`) for a four-person family (Mom, Dad, Karam age 11, Naya age 4). No build step, no dependencies, no package manager — open the file directly in any browser.

## Architecture

Everything lives in one file with three co-located layers:

- **CSS** (`<style>` block, lines 8–597): Uses CSS custom properties (`--cream`, `--sage`, `--terracotta`, etc.) defined in `:root` for the entire color palette. Component styles are grouped by section with comment dividers (e.g., `/* ─── PERSON CARDS ─── */`, `/* ─── MONTHLY EVENTS ─── */`).
- **HTML** (`<body>`, lines 599–1080): Six `<section>` panels — `#chores`, `#schedule`, `#meals`, `#grocery`, `#rules`, `#events` — toggled via `showSection()`. The schedule section has three nested timeline `<div>`s (`#weekday`, `#saturday`, `#sunday`) toggled via `showDay()`.
- **JS** (`<script>` block, lines 1081–1160): Vanilla JS — `showSection()` and `showDay()` toggle active classes/display; a checkbox listener toggles `.checked` on grocery items; `initCalendar()`, `changeMonth()`, and `renderCalendar()` drive the monthly events calendar.

## Key Conventions

- **Colors**: Always use CSS variables from `:root`, never hardcode hex values inline. Person-specific colors are `--dusty-rose` (Mom), `--dusty-blue` (Dad), `--terracotta` (Karam/son), `--gold` (Naya/daughter).
- **Typography**: `Fraunces` serif for headings/titles, `DM Sans` sans-serif for body text — both loaded from Google Fonts.
- **Person classes**: `.mom`, `.dad`, `.son`, `.daughter` drive colored accents on dots, headers, and tags throughout.
- **No persistence**: The grocery checkbox state resets on page reload — there is no localStorage or backend.

## Development

No server needed. Open `household-manager_1.html` directly in a browser (`open household-manager_1.html` on macOS). Changes are visible on reload.

To add a new tab section:
1. Add a `<button onclick="showSection('id')">` in `<nav>`
2. Add `<section id="id" class="section">` in `<main>`
3. No JS changes needed — `showSection()` is generic.

## Monthly Events Panel (`#events`)

The events panel renders a dynamic monthly calendar grid via JS. Recurring events are defined in the `RECURRING_EVENTS` array in the script block — each entry has a `label`, a `who` class (`son`, `mom`, `dad`), and a `days` array of day-of-week indices (0=Sun … 6=Sat). The calendar re-renders on month navigation without a page reload. To add a new recurring event, append an entry to `RECURRING_EVENTS` and add a matching `.legend-card` in the HTML.
