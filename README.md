# GAMBIT — HD2 Strategic Operations Center

> A Helldivers 2 tool for identifying and evaluating **Gambit** opportunities on the Galactic War map.

---

## Background

I'm a huge video game fan and have been as far back as elementary school. I've played so many games, completed a ton and have that dreaded unfinished backlog in plastic cases, CD folders and even my Steam and other game client libraries. I'm such a fan I even pursued a college degree at NJIT to become a level designer and even worked for some game studios in my career. This passion continues even today and has led me playing one of my favorite games pretty frequently: **Helldivers 2**.

Why HD2? For me, it's been the most dynamically changing game I've ever played. Every drop into a planet is a totally different experience and every new campaign acts like it's own DLC story line, which creates a sequel of sorts. All that for $40? AND it's PVE (player vs. enemies) so you can avoid a ton of toxic competition. You can't beat that for what you've paid for, in my opinion.

---

## Problem

This app was created because I wanted to solve a problem. I had been refining my skills in both coding and using Anthropic's Claude LLM and felt like I wanted to take a crack at the problem I've been seeing a lot recently on various Reddit posts in [r/Helldivers](https://www.reddit.com/r/Helldivers). Coming from the most recent story line campaign, it was brought up that people don't know what a "Gambit" is, how it's even performed, or what benefit it has on the Galactic Super Earth Map. This app is meant to solve that with the simplest UI and explanations I can think of to help players who are still confused on the topic of Gambits.

---

## What Is a Gambit?

The shortest and simplest example (explained in detail inside the app) is this:

If **Planet A** is attacking **Planet B**, Super Earth sends out a message ordering players to defend and hold Planet B. A potential Gambit is exposed when players can decide to attack Planet A instead — and if successful (liberating Planet A) it does a number of things:

- You've just stopped the attack on Planet B
- You've also just taken Planet A back from the enemy
- You've freed **2 planets** instead of 1 — which would have been just Planet B had you simply followed the defense order

There are examples of this where you can actually take more than two planets if the attacking planet is pushing its attack to multiple other planets.

### The Risk

The Gambit is beholden to certain factors that make it risky:

| Risk Factor | Why It Matters |
|---|---|
| Liberation progress on the attacking planet | Low progress means you may not finish in time |
| Defending planet health percentage | A near-dead defense won't survive long enough |
| Time limit of the defense | Not enough time = gambit fails |

For example: if players want to attack Planet A, but Planet A's liberation is below 25%, or the defense timer is only 3 hours with defense health critically low, or there wouldn't be enough players to join the attack before the timer expires — then a Gambit on Planet A is **not recommended**.

---

## Features

This app finds planets where active campaigns are happening (where players are currently fighting) and shows which planets have Gambit potential. The following information is displayed for a quick read-through so players can make a fast, informed decision:

- Which planets have Gambit potential
- Current metrics of the planet (liberation %, player count, decay rate)
- What other planets would benefit if the liberation is successful
- Liberation requirement checks
- Advice for the planet given its current stats
- Recommendations on what's needed to succeed

### Tabs

**Gambit Analysis** — The main tab. Auto-detects strategic Gambit opportunities from active campaigns and scores each one (0–100) with risk tiers: OPTIMAL, FAVORABLE, VIABLE, RISKY, and CRITICAL. For planets that are NOT RECOMMENDED, it also shows exactly what needs to change to make the Gambit viable.

**Strategic Scout** — (UNTESTED AT THIS TIME) Goes one step further by scanning the full galaxy for enemy-held planets with supply-line connections to active defense campaigns that have *no active liberation yet*. These are untapped opportunities — starting a liberation on any of these planets creates a new Gambit.

**What Is a Gambit** — A full explainer tab covering the concept with the classic Chicken game theory analogy, a real in-game example (Erata Prime → Bore Rock), the risk factors, and how to use the tool.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript |
| Data | [Helldivers 2 Community API](https://api.helldivers2.dev) (public, no auth) |
| AI Assistance | Anthropic's Claude |
| Fonts | Rajdhani + Share Tech Mono (Google Fonts) |

---

## Running Locally

This app fetches from an external API and must be served over HTTP (not opened directly as a file, due to CORS). Any simple static server works:

```bash
# Python 3
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080` in your browser.

---

## Data Source

Community API — not affiliated with Arrowhead Game Studios.
`https://api.helldivers2.dev`

Auto-refreshes every 60 seconds.

## The App 

To see this app in action, go here: https://amvents.github.io/GambitHD2/
