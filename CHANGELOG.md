# Changelog

Notable changes to Intention Lab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). The measurement protocol, statistics, score and interface have versions of their own, recorded with every session.

## [Unreleased]

## [0.1.0] - 2026-10-12

The first public release.

### Added

- Three games that respond to a hardware random number generator. The Bulb, a tungsten lamp, glows with the last few seconds. The Bar, a needle meter in a bakelite case, shows the whole part so far: a black needle on a damped spring for the running Z from −4 to +4, and a red needle for the goal that moves out as the part goes on. The Box, sealed with wax, shows nothing while you play and opens at the end on the record its built-in recorder wrote, each part's running Z under what that part asked for.
- Sessions in two directions of equal length, 1, 5, 10 or 20 minutes each, in random order, scored as Up minus Down after an alternating XOR mask (protocol `updown-v2`).
- Five levels set by how often chance alone reaches the goal, from 1 in 5 to 1 in 10,000; each goal is set from the device's measured speed.
- A score from 0 to 100 for every finished session (`score-v2`), explained in everyday words, and an overall score from every session started, in which a session stopped early counts only against you.
- Challenge, in the menu: a game, a level, a length and 5, 10 or 20 sessions, fixed before the first session and judged together after the last, in one verdict by the same rule as the overall score. Every session started counts, even one stopped early. A challenge can be given up; it is kept, marked, with no verdict.
- Profiles, for people who share the app. Each keeps its own History, Progress, Insights, challenges and exports, and remembers the level and length last played on each game.
- Simple and Lab modes. Lab adds the full analysis of each session with a replay, Insights across sessions with filters and groupings, CSV and JSON export, a simulation source and reference captures.
- An illustrated guide to how a session is measured and scored, with equations in Lab mode.
- Sound, made in the browser: the Bulb hums like a lamp on a dimmer; the Bar sings its reading like a theremin, and from half way through a part a relay and a bell sound when the black needle reaches the red one; the Box plays a steady drone of two tones beating 10 times a second, with an option to send one tone to each ear for headphones. Whether sound was on is recorded with each session.
- Portable packages for Windows x64 (Native AOT) and Linux x64. Everything stays on the computer: the app listens only on 127.0.0.1 and keeps its data in the browser.

[Unreleased]: ../../compare/v0.1.0...HEAD
[0.1.0]: ../../releases/tag/v0.1.0
