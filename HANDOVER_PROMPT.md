# Eviota — opening prompt for a new session

Paste this as the first message of a new conversation, with the latest Eviota zip attached. If you are a session reading it: it is addressed to you.

**Start here.** Extract the zip. Read `HANDOVER.md` in full, then the "Verification log" at the end of `futureplans.md`, then skim `docs/strategy.md` (the owner's product direction; its claims about other products are unverified). Do not change anything before both are read. Then re-check the environment facts in `HANDOVER.md` yourself (they describe a past sandbox, not this one) and take a baseline: `npm install`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:static`, and `npx eslint .` (compare the error count with the number in `HANDOVER.md`; do not add to it). If the baseline is not clean, say so first.

**Rules that do not change**

- A claim is only as good as what you checked it against. Take expected values from real output, not hand arithmetic. For anything tricky, break the implementation on purpose and confirm the test fails for the right reason, then restore it.
- Tick a checklist box only for something you ran. Write "not verified" for anything you could not run (browser behaviour especially). Never add a script that writes pass/fail claims into the docs.
- Documents written by other tools or sessions are claims, not facts. A past round ticked "delete `src/test/`" without doing it, and wrote "typecheck clean" while `tsc` failed.
- Scope to what was asked. Do not add features, server code, accounts or keys; the product must stay free to host as static files, and `npm run verify:static` must keep passing.
- Never run Prettier over `public/vendor` or `public/samples`; format only files you edit.
- Treat copyrighted or pirated material (scene-release tags in a filename) as off-limits: decline in one line and suggest public-domain or synthetic material.
- A finished checkpoint is a verified zip: package without `node_modules/`, `dist/`, `test-results/` and `playwright-report/`; extract it into an empty directory; run `npm ci` (or `npm install`), typecheck, tests, build and `verify:static` there; only then deliver. Name it `eviota-checkpoint-N.zip` with the next integer.
- Update `HANDOVER.md` (state, next steps, decisions) and add a dated entry to the verification log every checkpoint, including review-only ones. Remove resolved items instead of striking them through.
- The sandbox can reset between turns and takes unzipped work with it: after each meaningful batch, run the checks and deliver a zip.
- Before `npm run test:e2e`, make sure nothing listens on port 4173: the config reuses a running server and skips the build, so the specs would test whatever it serves. Kill a leftover preview by PID (`pgrep -f "[v]ite.js preview"`), never with `pkill -f "vite.js preview"` (it kills your own shell). The full run takes about ten minutes and does not survive a pause of the session: keep the turn open, poll until it prints its summary, and do not report a partial run as a result.
- The owner tests on a real iPhone (through ngrok, see `HANDOVER.md`) and sends screenshots. Read every screenshot closely before answering (measure it when that helps), and say what a screenshot does and does not show.
- Pace the work to what can be finished and verified in one response. If it will not all fit, say exactly what is done and what is not.
- Match the register: dense, specific, no marketing language, and always separate what was verified, what was reasoned, and what was assumed.

A plain "continue" means pick the best-justified next item from "Next, in order" in `HANDOVER.md`, state why in a sentence, and build it.
