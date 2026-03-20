0\) Scope decision (so you don’t contradict yourself later)



You said: multi-agent for pot-wide, user-triggered features (Discover Links / Journal / Project Planning / future “intel” style features), not for the always-on per-entry pipeline (tags/entities/summary). That separation is smart: it keeps your base pipeline stable and predictable, and your “heavy thinking” features opt-in.



Also: do not let role text control model/provider/temp/schema — that stays in task config. 



Agent\_Roles



1\) Core design principles (non-negotiable)



Never bypass assemblePrompt(). Every sub-agent still gets \[SYSTEM\_BASELINE] + \[SECURITY\_GUARDRAILS] + \[POT\_ROLE]. 



Agent\_Roles



Pot Role stays the “constitution.” Sub-agent roles are “specialist lenses,” not replacements. 



Agent\_Roles



Sub-agents don’t write user-facing DB state directly. They return JSON → orchestrator merges → orchestrator writes the final artifact. 



Agent\_Roles



Schema validation everywhere (same Phase 7 discipline). 



phase\_7



Prompt injection defense + “derived artifacts are not truth.” Keep the security model intact. 



security



2\) Data model changes

2.1 Pot-level multi-agent config



You need to store: enabled, agent\_count, and role refs per agent slot.



Option A (simple, pragmatic): add to pots



pots.multi\_agent\_enabled (INTEGER 0/1)



pots.multi\_agent\_count (INTEGER)



pots.multi\_agent\_slots\_json (TEXT JSON)



Example:



{

&nbsp; "slots": \[

&nbsp;   { "slot": 1, "role\_ref": "builtin:research\_assistant@v1" },

&nbsp;   { "slot": 2, "role\_ref": "builtin:forensic\_analyst@v1" },

&nbsp;   { "slot": 3, "role\_ref": "user:custom/skeptic@v1" }

&nbsp; ]

}





Option B (cleaner, future-proof): normalized table



pot\_agent\_slots:



id, pot\_id, slot\_index, role\_ref, created\_at, updated\_at



plus pots.multi\_agent\_enabled, pots.multi\_agent\_count



I’d pick Option B if you’re already comfortable with migrations, because you’ll inevitably want per-slot metadata later (last run, failures, etc.).



2.2 Multi-agent run tracking (for progress + debugging)



Add:



multi\_agent\_runs



id, pot\_id, feature (links|journal|plan|intel), status



agent\_count



pot\_role\_hash



agent\_config\_hash (hash of slots + role refs)



input\_hash (feature args; e.g. “journal for last 7 days”)



created\_at, started\_at, finished\_at, error



multi\_agent\_run\_steps



run\_id, slot\_index, status, job\_id, model, tokens\_in/out, error



output\_artifact\_id (optional)



This gives you: UI progress bar, retry control, and a sane audit trail.



2.3 Artifacts + idempotency keys



You already have the doctrine: “don’t duplicate derived artifacts; upsert by keys.” Extend it with role/config hashes.



You already noted role hash should be part of idempotency for artifacts. 



Agent\_Roles



For multi-agent outputs, treat the final output as the stable artifact:



derived\_artifacts.artifact\_type:



journal\_v2 / project\_plan\_v1 / pot\_intel\_v1 / link\_batch\_insights\_v1



store in payload provenance:



pot\_role\_hash



agent\_config\_hash



prompt\_id/version



models used



run\_id



Optional: also store sub-agent outputs as internal artifacts (artifact\_type=multi\_agent\_step\_v1) but hide them in UI unless debug mode.



3\) Roles: how to support “built-in + custom” without footguns



Your Agent\_Roles.txt already sets the pattern:



built-ins live in packages/ai/roles/\*



user edits live in Electron userData (plus optional mirror in Documents)



DB stores only role\_ref, not file paths. 



Agent\_Roles



Extend the same system for sub-agents:



role\_ref can be:



builtin:<role>@v1



user:pot/<potId>/role@v1 (your existing pot role)



user:custom/<customRoleId>@v1 (new: user-defined reusable roles)



Add a tiny “custom role registry”:



user\_roles table (metadata only)



id, name, role\_ref, created\_at, updated\_at



actual text stored as a file in userData.



Enforce:



hard cap role length (8k–12k chars)



lint warnings (missing “Evidence rules”, etc.)



role text cannot change runtime tool surface or schema constraints. 



Agent\_Roles



4\) Orchestration: implement as Worker job handlers (not UI spaghetti)



Per your own guidance: orchestrate inside worker, with a single job type per feature. 



Agent\_Roles



4.1 Job types



Add job types like:



multi\_agent\_journal\_run



multi\_agent\_project\_plan\_run



multi\_agent\_link\_insights\_run



multi\_agent\_intel\_run



Each job handler does:



Resolve base pot role once:



baseRole = roleRegistry.resolveEffectiveRole(potId)



Load agent slots (N) from DB



Build a Context Pack (see 4.2)



Dispatch sub-agent AI calls concurrently (bounded):



Promise.all() but with a concurrency limiter (e.g. 3 at a time)



Validate each sub-agent response against schema



Run aggregator model on the collected outputs



Validate aggregator response



Write one final derived artifact + audit events



4.2 Context Pack (so you don’t send 10,000 entries to 6 agents)



The key is: feed agents summaries/entities/tags first, not raw entry bodies.



Phase 8 explicitly calls out that candidate generation uses Phase 7 artifacts (tags/entities/summaries). Lean into that. 



phase\_8



So build:



list of entries with:



entry id, captured\_at, source\_url/title



latest summary artifact (including claims + evidence excerpts)



entities/tags (optional)



cap the pack:



e.g. last 200 entries by default, or “entries involved in last X days,” or “top entities”



allow feature-specific filtering:



journal: time-window



project plan: entries tagged “requirements|todo|decision”



links: entries with summaries present



If you need deep evidence, the orchestrator can selectively include full text only for a handful of entries.



4.3 Barrier / dependency handling (without building a DAG engine)



Simplest reliable pattern:



Orchestrator job runs → does sub-agent calls → then aggregator call → done.

No dependency graph required.



If you later want “spawn N jobs + aggregator job”, do the barrier requeue trick:



aggregator job checks “do I have all step outputs yet?”



if no: requeue with backoff

That avoids a full dependency system.



5\) Prompt assembly: how to combine Pot Role + Sub-Agent Role safely



You want this ordering every time:



\[SYSTEM\_BASELINE]



\[SECURITY\_GUARDRAILS]



\[POT\_ROLE] (base constraints)



\[SUB\_AGENT\_ROLE] (specialist lens)



\[TASK\_PROMPT] (schema + task instructions)



\[CONTEXT\_PACK]



This matches the “Pot role is overarching, task prompt enforces JSON-only” doctrine. 



Agent\_Roles



6\) Schemas: make sub-agents structured so the aggregator isn’t guessing



For each feature, define two Zod schemas:



Step schema (one per agent)



Final schema (aggregated)



Example: Journal



Step output:



highlights\[] (each with evidence pointers)



open\_loops\[]



risks\[]



recommended\_actions\[]



notable\_entities\[]



confidence



Final output:



merged highlights (deduped)



consensus actions + “disagreements”



“what changed since last journal”



explicit list of entry IDs used + evidence excerpts



Example: Discover Links (integrate with Phase 8)



Phase 8 already defines deterministic candidate generation + AI classification. 



phase\_8



Your multi-agent layer should not replace that. It should:



help decide which candidates are worth classifying (cost control)



and/or propose additional candidates that deterministic heuristics missed



A safe hybrid:



deterministic generate\_link\_candidates produces a big set (cheap)



split candidates into chunks, give to sub-agents:



Agent A: “contradictions”



Agent B: “same entity/timeline sequences”



Agent C: “duplicates / same source”



each agent returns top\_candidates\[] (pair ids + rationale)



aggregator merges + picks top X



enqueue classify\_link\_candidate only for that curated set



This preserves your scalable design and makes the AI spend tokens only where it matters.



7\) UI changes (pot settings)



Add a “Multi-Agent” section in Pot Settings:



Toggle: enabled



“Number of agents” stepper (backend-enforced max, e.g. 1–8)



For each slot:



dropdown: built-in roles + custom roles



button: “Create custom role” (saves user:custom/<id>@v1)



show “Effective config hash” + last run status



Also: do not auto-rerun everything on edit. Keep it manual. 



Agent\_Roles



8\) Improvements worth adding now (cheap wins)



Concurrency limiter for AI calls (prevents nuking OpenRouter and your wallet).



Config snapshot + reproducibility: store agent\_config\_hash + input\_hash in artifacts so you can reproduce runs.



Consensus + dissent: aggregator outputs “what agents agree on” and “where they disagree.” This reduces hallucinated certainty.



Cost estimator in UI: “This will run N agents + 1 aggregator; approx tokens based on context pack size.”



Role lint + caps (already aligned with your role plan). 



Agent\_Roles



9\) Test plan (minimum that proves it’s real)

Unit



role resolution for sub-agent role refs



config hashing stable across same inputs



schema validation rejects junk



Integration (mock AI provider)



create pot → set multi-agent slots → run journal job



assert:



assembled prompt includes pot role + sub-agent role



step outputs validated



final artifact written with agent\_config\_hash + pot\_role\_hash



prompt injection fixture in entry text doesn’t override role/guardrails. 



security



QA smoke



pot with ~20 entries



run:



journal (time window)



discover links (curation → enqueue classifications)



verify job lifecycle + artifacts appear



10\) Suggested commit breakdown (keeps it shippable)



feat(db): add pot multi-agent config + multi\_agent\_runs tables



feat(api): add pot multi-agent settings get/put



feat(worker): add multi-agent orchestrator skeleton + concurrency limiter



feat(ai): add step/final prompts + schemas for journal + project plan



feat(worker): integrate link discovery curation into Phase 8 flow



feat(ui): pot multi-agent settings panel + slot editor



test: integration tests for multi-agent runs



docs: update pipeline + security notes

