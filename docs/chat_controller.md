The concept

What you have today



User message



You build a “messages\[]” payload + context



You call the chat model (OpenRouter)



You render response + citations



What you want



Add a step before calling the model:



New step 2a: Controller



reads: user message + small stats (history length, active-context size, pot size)



outputs: a small JSON “routing decision”:



mode: greeting / fact / explain / debug / plan / brainstorm



verbosity: short / medium / long



max\_tokens: 120…1500



temperature: maybe adjust



style: e.g., “answer-first, then optional details”



needs\_more\_context: boolean (optional)



Then step 3 uses this routing decision to shape the final call.



Why it works



Models are decent at adapting tone, but they’re unreliable at self-limiting length unless you constrain them. The controller is basically you saying:



“This is a greeting → 1 line.”



“This is a simple factual question → 1–2 lines.”



“This is a deep request → compact overview with optional detail.”



You can implement it with:



heuristics (fastest, no extra model call), or



an LLM controller (your preference), using the same model as chat.



You asked for “same model is good” — that’s fine. Latency goes up a bit, but UX improves dramatically.



How it should work (clean, low-risk)

Controller prompt location



You said controller prompt files live here so you can tweak them:



<install_dir>\prompts\



So: create a new prompt file there, e.g.:



chat\_controller.md (or YAML-ish header like your others)



Controller inputs



Give it only what it needs; keep it small:



user\_text



conversation\_stats: message count, last assistant length, etc.



active\_context\_stats: number of loaded entries, estimated tokens/chars



pot\_stats: entries count (optional)



Avoid shoving the whole conversation into the controller — you don’t want it doing “analysis,” just routing.



Controller output (strict JSON)



Example:



{

  "mode": "greeting",

  "verbosity": "short",

  "max\_tokens": 80,

  "temperature": 0.2,

  "format": "answer\_only",

  "needs\_more\_context": false,

  "reason": "User said hi"

}



(Reason is optional but useful for debug logging.)



Main chat call uses controller result



sets max\_tokens



possibly sets temperature



injects a small “verbosity directive” into the system prompt or as an internal instruction message, like:



VERBOSITY=short; MODE=fact; FORMAT=answer\_then\_optional\_details



“Expand” flow



When verbosity is short/medium, the assistant includes a tiny tail hint:



“Want the deeper breakdown?” (or your UI renders an Expand button)



Best approach: structured sections so the UI can collapse:



Answer: ...



Details: ... (only when mode says so)



But you can also keep it simple and just have the UI send a follow-up message:



“Expand on that” → controller routes to long mode.



Complexity + risk



Complexity: low to medium.



One new prompt file.



One new “controller call” in the chat request pipeline.



A tiny response parser + fallback.



Risk: low.



No DB migrations required.



Worst case: controller misclassifies → you fall back to normal chat settings.



You must add guardrails: if controller fails/invalid JSON → default to normal mode.


One extra tip (the “don’t shoot yourself in the foot” guardrail)



When you implement the controller with the same model, don’t let it request huge outputs. Controller call should be something like:



max\_tokens: 120–250



temperature: 0.0–0.2



strict JSON output



It’s a router, not a novelist.

