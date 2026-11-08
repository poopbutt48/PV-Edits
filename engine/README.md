# 🌱 Sprout Engine

A 2D game engine made for complete beginners, with a built-in AI helper that can do anything in the editor **and shows you how**: it moves its own purple cursor around the real editor, highlighting every button it presses. When it's done, it gives a short list of what it pressed, and you can **rewind and replay** every step.

> Sprout Engine is a working name - change it whenever you like.

## What you can do

- **Build scenes** like in Godot: levels, menus and reusable things (a Coin, an Enemy) that you place copies of.
- **Objects:** Sprite (picture), Shape, Text, Tile Map, Camera, Scene Copy, Group. Every setting has a plain-English "?" explanation.
- **Physics without the confusing parts:** pick a *Body type* (Solid, Platform, Character, Trigger) right in the Inspector. Characters walk, fall with gravity and bump into walls automatically.
- **Paint levels** with Tile Maps (solid tiles, one-way platforms).
- **Draw pixel art** and simple animations in the built-in Pixel Art editor. Starter pictures and built-in sounds are included, so nobody starts with an empty page.
- **Write scripts in JavaScript.** Code completion knows the engine. There are friendly error messages ("`speed` is not defined - check the spelling…") with a **Show me the line** button and a **🤖 Fix with AI** button.
- **Play inside the editor** with ▶ Play. On phones and tablets, on-screen buttons appear automatically.
- **Export your game** as a single web page that plays in any browser.
- Undo/redo for everything, and autosave.

## The AI helper

- Ask it to *do* something ("add an enemy that walks back and forth") and it works the editor with its own cursor: it opens the same menus, types into the same fields and writes the code in the same script editor you use. It also plays your game to test its work.
- Ask *how* to do something ("where do I change gravity?") and it points at things and explains, without doing it for you.
- After each request you get **What I pressed**: a numbered, one-line-per-step list of the buttons it pressed. You also get:
  - **⏪ Rewind & watch again**: replays the AI's work step by step (play, pause, next, previous). Closing the replay puts your project back exactly as it was.
  - **↶ Undo all of this**: removes everything that request changed.
- You can choose the cursor speed (Slow is best for learning), press **■ Stop** at any time, and watch a **pre-recorded demo** before setting anything up.

**It needs a Claude API key.** Each person adds their own key in **Settings → AI helper**, and Anthropic bills them for what they use. The key is stored only on that device and is sent only to Anthropic. You can pick Claude Opus 5.5 (best), Sonnet 5.5 (cheaper) or Haiku 5.5 (cheapest, for simple tasks). The editor shows roughly how many tokens each request used.

## Running it

### Windows app
The GitHub Actions workflow (`.github/workflows/sprout-engine.yml`) builds a Windows installer and a portable `.exe` on every push. Open the workflow run on GitHub and download **sprout-engine-windows** from *Artifacts*. The app isn't code-signed yet, so Windows SmartScreen will warn you the first time ("More info → Run anyway").

To build it yourself on Windows: `npm install`, then `npm run dist:win`. The installer appears in `release/`.

### Android app
The same workflow builds an installable debug `.apk` (**sprout-engine-android**). The full editor runs on phones and tablets. In split-screen or a freeform window the layout adapts, and narrow windows switch to bottom tabs (Scene, Objects, Inspector, Assets, Output, AI).

To build it yourself: install Android Studio, then `npm install`, `npm run android:add` (first time only; later `npm run android:sync`) and `npm run android:open`.

### In a web browser (quickest for trying it)
```bash
cd engine
npm install
npm start          # builds, then serves http://localhost:8080
```

## For developers

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/` (editor + standalone game runtime) |
| `npm run watch` | Rebuilds on every change |
| `npm start` | Build + local web server |
| `npm test` | End-to-end tests in a headless browser (needs Playwright: `npm i -D playwright && npx playwright install chromium`) |
| `npm run desktop` | Runs the desktop app with Electron |
| `npm run dist:win` | Builds the Windows installer |
| `npm run android:add` / `android:sync` / `android:open` | Creates, updates or opens the Android project (Capacitor) |

### How it fits together
```
src/runtime/     the game engine (no editor code): objects, physics, scripts, input, sound, drawing
  nodeTypes.js   every object type and property, described once; used by the runtime, the Inspector and the AI
  apiDocs.js     the scripting reference, used by Script help, code completion and the AI
src/editor/      the editor
  store.js       the project and every change you can make to it (all edits go through here: undo, autosave, replay)
  panels/        Scene tree, Scene view, Inspector, Assets, Output, Script editor, Pixel editor, Play view, dialogs
src/ai/          the AI helper
  cursor.js      the visible cursor: moves, highlights, clicks, types, and records each action
  tools.js       everything the AI can do; each tool drives the real interface with the cursor
  agent.js       the request → tool calls → results loop (Claude Messages API with tool use)
  replay.js      rewind & replay (restores the snapshot before each step and re-runs it)
  providers/     Claude (anthropic.js) and the pre-recorded demo (demo.js)
electron/        Windows/desktop app shell
capacitor.config.json   Android app shell
```

The AI never edits the project behind your back. Every tool goes through the same buttons and fields a person uses, so whatever the AI can do, you can learn to do too. Each step stores a snapshot before and after it runs, plus the ids it created. That's what makes replay exact: the automated tests replay a 30-step session and check the result is identical.

## Known limitations and plans

- **2D only for now.** The runtime keeps drawing and physics separate from the editor so 3D can be added later.
- **Collisions are boxes.** Rotation doesn't affect them, and characters don't push each other.
- **Endless loops freeze the editor.** A script with an infinite `while` loop freezes the editor (your work is autosaved before every Play). Running games in a separate worker is planned.
- **Free offline AI is planned, not built yet.** Local models (for example Google's Gemma) wouldn't charge per request. They need a capable device and are much less reliable at multi-step editor work. The AI code is structured so another provider can be plugged in (`src/ai/providers/`).
- **The full AI loop hasn't run with a real key yet.** It was tested with a scripted stand-in AI that calls every tool. Against the real Claude API, only the connection was checked (using a deliberately invalid key, which was correctly rejected).
- **No icon or code signing yet.** The Windows build has no custom icon or signature, and the Android build is a debug build (for app stores it would need a signed release build).
