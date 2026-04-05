# HexGuessr

`Link`: [hexguessr.com](https://hexguessr.com)

`Fallback`: [hexguessr.pages.dev](https://hexguessr.pages.dev)

A retro-inspired web game where you attempt to guess a target color's hexcode within 6 tries.

HexGuessr combines Wordle-style per-character feedback with a live color picker so you can reason visually and numerically at the same time.

## Gameplay

- Guess a 6-digit hex color (`#000000` to `#FFFFFF`) in up to 6 attempts.
- Use the reveal square once per attempt to briefly preview the target color.
- Refine guesses using the color canvas, hue slider, and hex input field.
- Submit guesses into the 6x6 grid.

### Feedback Rules

Each character gets one of three feedback states:

- `Correct`: digit in position is correct.
- `Near`: digit is off by 1 (example: `7` or `9` when target is `8`).
- `Far`: digit is off by more than 1.

## Modes

- `Daily`: one shared color per UTC day for everyone.
- `Unlimited`: endless random colors for practice.

## Features

- Pixel-art UI with responsive scaling system.
- Light/Dark mode toggle (saved in `localStorage`).
- In-game stats modal (per mode):
  - Games played / won / lost
  - Win percentage
  - Current / max streak
  - Average guesses
  - Guess accuracy
  - Guess efficiency
- Daily persistence:
  - Ongoing game state survives refresh.
  - Completed daily stays completed for that day.
- Keyboard + on-screen keypad input.
- Copy/paste helpers for hex values.
- Accessible modal behavior (focus trap, escape to close, blocked background input).

## Tech Stack

- Frontend: vanilla `HTML`, `CSS`, `JavaScript`
- Daily API: Cloudflare Pages Functions (`functions/api/daily-color.js`)
- Routing/headers: `_redirects` + `_headers`

## Local Development

### 1) Quick frontend-only run

This is enough for UI work. If `/api/daily-color` is unavailable, the app gracefully falls back to `Unlimited` mode.

```bash
python3 -m http.server 8787
```

Open: `http://localhost:8787`

### 2) Run with Daily API locally (Cloudflare Pages Functions)

Set a secret salt and run Pages dev.

```bash
# Example
export SECRET_SALT="your-long-random-secret"
npx wrangler pages dev .
```

Then open the local URL printed by Wrangler.

## Deployment (Cloudflare Pages)

1. Connect this repo to Cloudflare Pages.
2. Set:
   - Build command: *(none)*
   - Build output directory: `/`
   - Functions directory: `functions`
3. Add environment variable:
   - `SECRET_SALT` (required in Production/Preview)
4. Deploy.

### Why `SECRET_SALT` matters

The daily color is generated server-side using HMAC(date, secret), then converted to RGB/hex. This makes the daily color deterministic per day but not guessable from client code alone.

## Project Structure

```text
.
├── index.html
├── styles.css
├── app.js
├── functions/
│   └── api/
│       └── daily-color.js
├── assets/
│   ├── fonts/
│   ├── pngs/
│   └── svgs/
├── _redirects
├── _headers
├── favicon.ico
└── favicon.png
```

## Data & Privacy

HexGuessr stores gameplay preferences and stats in browser `localStorage`:

- Theme preference
- Daily completion/state
- Stats per mode

No account system is required.

## Credits

- Game design & development: [KapuuZapuu](https://github.com/kapuuzapuu)
- Fonts: Press Start 2P, IBM Plex Mono
