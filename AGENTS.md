# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**Home Sweet Home — Family Command Center** is a static HTML dashboard (`index.html`) for a four-person family (Mom, Dad, Karam age 11, Naya age 4). No build step, no dependencies, no package manager — open the file directly in any browser.

## Architecture

The app is split into three flat files in the same directory:

- **CSS** (`styles.css`, lines 1–1042): Uses CSS custom properties (`--cream`, `--sage`, `--terracotta`, etc.) defined in `:root` for the entire color palette. Component styles are grouped by section with comment dividers (e.g., `/* ─── PERSON CARDS ─── */`, `/* ─── MONTHLY EVENTS ─── */`).
- **HTML** (`index.html`, lines 1–643): Six `<section>` panels — `#chores`, `#schedule`, `#meals`, `#grocery`, `#rules`, `#events` — toggled via `showSection()`. The schedule section has three nested timeline `<div>`s (`#weekday`, `#saturday`, `#sunday`) toggled via `showDay()`. `styles.css` is linked in `<head>` and `app.js` is loaded at the bottom of `<body>`.
- **JS** (`app.js`, lines 1–741): Vanilla JS — `showSection()` and `showDay()` toggle active classes/display; a checkbox listener toggles `.checked` on grocery items; the calendar app handles event storage, rendering, navigation, view switching, modals, drag and drop, and theme toggling.

## Key Conventions

- **Colors**: Always use CSS variables from `:root`, never hardcode hex values inline. Person-specific colors are `--dusty-rose` (Mom), `--dusty-blue` (Dad), `--terracotta` (Karam/son), `--gold` (Naya/daughter).
- **Typography**: `Fraunces` serif for headings/titles, `DM Sans` sans-serif for body text — both loaded from Google Fonts.
- **Person classes**: `.mom`, `.dad`, `.son`, `.daughter` drive colored accents on dots, headers, and tags throughout.
- **Persistence**: Grocery checkbox state resets on page reload. Calendar events and the calendar theme use `localStorage`; there is no backend.

## Development

No server needed. Open `index.html` directly in a browser (`open index.html` on macOS). Changes are visible on reload.

To add a new tab section:
1. Add a `<button onclick="showSection('id')">` in `<nav>`
2. Add `<section id="id" class="section">` in `<main>`
3. No JS changes needed — `showSection()` is generic.

## Monthly Events Panel (`#events`)

The events panel renders a dynamic calendar via `app.js`. Seed events are defined in `seed()` and recurring rules live on each event as `recurring` metadata, including `type`, `days` (0=Sun … 6=Sat), and `until`. The calendar supports month/week/day/agenda views, category filtering, search, drag and drop, and event CRUD through `localStorage`.
