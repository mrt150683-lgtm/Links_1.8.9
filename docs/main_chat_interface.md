0\) Prime Directive

Keep PotChat perfect and untouched



PotChat stays the stable “pot-scoped chat UI” and keeps behaving exactly as it does now.



We clone the minimum required PotChat UI surface into a new MainChat module and evolve that.



PotChat remains the “known good baseline,” MainChat becomes the “proactive hub + memory conductor.”



This matches your repo rules: modular by default, no surprises, testable features, evidence-first 



logging



1\) What You’re Building (Conceptual System)



You’re building a two-mode conversational OS:



A) PotChat (existing)



Chat tied to a specific pot.



Uses that pot’s entries/artifacts as context.



Works perfectly → do not modify.



B) MainChat (new)



A global “front door” chat that can:



act as a general assistant (project spaces like “Diet”, “Job search”, “Research idea”)



act as a meta-conductor across pots (overview/patterns)



act as a proactive agent (nudges, notifications, idle discoveries)



manage inbox → triage → store flows (uploads, web captures, temp items)



MainChat is where your “AI initiates conversation” and “daily/monthly memory” lives.



2\) The Core Data Philosophy (So It Doesn’t Turn Into Fog)



You already have the right doctrine in your backend plan:



Original captured data is immutable



AI outputs are derived artifacts with provenance and schema validation 



rules



&nbsp;



phase\_1



MainChat must follow the same:



Every summary, journal, nudge, “insight,” and memory update is a derived artifact, not truth.



Every proactive thing must be explainable (“why did I get this?”) and dismissible.



3\) Memory System Design (Your “Daily Journal → Monthly Digest → Rolling Context”)



This is the “memory ball” idea, but sane.



Layer 0: Raw entries (existing)



Captures: text, docs, links, images.



Stays immutable. Hashes + provenance. 



phase\_2



&nbsp;



phase\_3



Layer 1: Derived artifacts (existing direction)



tags/entities/summary per entry 



phase\_1



link discovery between entries (supports/contradicts/duplicate/etc.) 



phase\_8



Layer 2: Daily Journal artifact (new)



A daily “what happened” memory capsule.



Generated automatically (you already have journal production conceptually).



Must include citations back to entry IDs (critical requirement you stated).



Should be pot-aware (or project-space aware):



either one daily journal per pot



or one daily global journal with per-pot sections



Output is locked; users can add annotations/comments/highlights, not edit the journal itself.



Layer 3: Monthly Digest artifact (new)



Once a month, summarize that month’s Daily Journals into a monthly overview.



Store it as a locked artifact with:



month range



referenced daily journal IDs



referenced pot IDs



“top themes / key changes / open loops”



This becomes your “fast recall without loading everything.”



Rolling Context Rule (your chosen model)



Keep current month “live” and update it as new daily journals arrive.



Keep past months “archived” (immutable snapshot).



MainChat loads:



current month digest



optionally previous month digest



and recent daily journals as needed.



This avoids “summaries of summaries of summaries” spiraling into fiction.



4\) “Evolving Memory” Without Breaking Auditability (Your conflict/change concern)



You asked: what if beliefs change over time? You nailed the correct approach:



Create a “Current Memory” view that is replaceable, but always traceable



Keep originals immutable.



Maintain a CurrentMemory table (or artifact set) that holds “latest known state” items:



each item has a stable ID (“memory key”)



each item links to evidence (entry IDs / journal IDs)



each update replaces the “current” version but never deletes history



A fast/cheap model can do:



“is this the same thing?”



“contradiction?”



“supersedes?”



Link discovery mechanisms already align with this idea (supports/contradicts) 



phase\_8



Result: your “current beliefs” update cleanly, but everything remains auditable.



5\) Proactive AI (The Big Differentiator)



This is your “AI stops being one-way.”



Proactivity surfaces in 3 places:

A) On App Open (session kick-off)



MainChat can start in one of two modes:



Contextful Start (default ON)



pulls in:



pending notifications



latest uploads/captures



current month digest + recent daily journals



any “idle discoveries”



starts with a short message:



“You’ve added X things since last time. Want to look at (A) insight, (B) uploads, (C) goals, or start blank?”



Free-Flow Start



no auto context injection



“blank chat” behavior



user can toggle this permanently or per session



B) “Notification Inbox” (always safe)



A bell icon/inbox stores all nudges and insights.



Clicking a notification opens MainChat pre-loaded with just the context for that notification.



If notifications are ignored:



don’t spam new ones



show them next time MainChat opens (your requirement)



provide “dismiss / snooze / later / mute this type”



C) Idle-Time Intelligence (your background “researcher” mode)



You already have “idle intelligence crunching” conceptually:



user defines away times / idle schedule



system runs low-temp processing to find missed connections



only alerts when it’s “gold not noise”



This fits your worker/idle-time design principles 



phase\_5



6\) The Nudge/Alert Decision System (So It Doesn’t Become Annoying)



This is where most products die: they annoy the user.



You’ve already proposed the right controls. Formalize them:



Nudge Types (separate toggles)



Greeting / check-in (social)



“You added stuff” triage prompt (workflow)



Idle discovery insight (research)



Goal-aligned prompt (“this matches your project goal”) (high value)



Reminder-style nudges (optional)



Trigger Inputs



new content saved (entry/doc/link)



idle intelligence result



daily journal generated



monthly digest generated



app opened (session boundary)



Scoring / gating (must exist)



Each candidate nudge gets:



Confidence (how sure)



Novelty (how non-obvious / worth pinging)



Relevance-to-goal (matches pot goal)



User tolerance (slider)



Cooldown state (don’t repeat)



You explicitly want: high confidence + low novelty for most nudges (i.e., “this is clearly relevant and not random”). Keep “high novelty” for opt-in “surprise me” mode.



Rate limiting rules (you described these)



If greeting ignored → don’t greet again for 24h (or user-defined).



If inbox not opened for X days → enter “pause state” (reduced nudges).



If user dismisses a category repeatedly → auto-suggest disabling it.



If user is active in free-flow mode → don’t inject “work mode” stuff.



7\) Project Spaces (OpenAI-style “Projects”, but smarter)



You want chats that are not necessarily tied to pot data:



“Diet plan” project space



“Life admin” space



“Idea generator” space



etc.



Behavior



Conversations in a project space are stored as a chat transcript object (not shoved into a pot by default).



On close or periodically:



“Summarize \& tag this conversation?”



“Store it where: \[Pot A] \[Pot B] \[Temporary] \[Don’t store]”



If stored:



create an entry (or doc entry) + derived artifacts (tags/entities/summary) 



phase\_1



provenance indicates “source = main\_chat project space”



8\) Upload / Triage Flow (Your “where do you want it stored?” feature)



When user uploads a document (or pastes a link/text):



Ingest asset (doc/image) safely (your Phase 4 style) 



additional



Immediately ask:



“Store this in: \[Pot] / \[Multiple pots] / \[Temporary holding]”



Run the same analysis pipeline:



tags/entities/summary (for text or extracted text)



link discovery later



If stored as Temporary:



it still gets processed



but it lives in a “staging pot” or “inbox pot” concept until assigned



9\) Goals Per Pot (Needed for “goal-aligned nudges”)



You said: “goal of this project is X, so only alert me when something matches.”



So add:



pot-level metadata:



goal\_statement



optional “goal tags”



optional “do not bother me about” tags



idle intelligence uses these to decide what to surface.



10\) Tone + “Dictionary” + Sarcasm Dial (but user-controlled)



You want MainChat to feel like you:



learns phrasing (“dictionary”)



can greet in your style



has a sarcasm/humor dial



Plan requirements:



Tone features are:



per-user setting



per-chat override (“serious mode” toggle)



never forced



Store tone settings as preferences (like your Phase 3 prefs design patterns) 



phase\_3



11\) Model Strategy (Default cheap, user can upgrade)



You want:



default: a cost-effective fast model (you named grok-4.1-fast)



optional: premium models (you named o1 pro)



Implementation plan:



Use the same “per task model selection” approach you already designed for OpenRouter integration: default model + per-task overrides 



phase\_10



Tasks that need model selection:



daily journal generation



monthly digest



nudge generation



“compare/update current memory” (cheap model)



idle intelligence summarization / link classification



Important: store model\_id + prompt\_id + prompt\_version + temperature with every derived artifact (your existing doctrine) 



phase\_1



12\) Data Objects You’ll Need (No code, just the concepts)



Minimum “new” primitives to add:



MainChat



ChatSession (mode, scope, created\_at, last\_active)



ChatMessage (role, content, created\_at, references)



Notifications



Notification (type, title, one-line preview, payload refs, created\_at, state)



State: unread / opened / dismissed / snoozed / expired



Memory Artifacts



DailyJournalArtifact (date, scope, citations to entries)



MonthlyDigestArtifact (month, scope, citations to daily journals)



CurrentMemoryItem (stable key, current value, last\_updated, evidence refs)



UserAnnotation (comment/highlight attached to an artifact)



Settings / Preferences



Proactivity enabled



Proactivity frequency slider



Category toggles



Quiet hours / idle schedule



Per-pot AI access allowlist/denylist



Tone dials



Skill level slider



Model prefs (default + per-task overrides)



This is consistent with your existing preference-table approach patterns 



phase\_3



13\) Processing Jobs (How It Actually Runs)



This plugs cleanly into your job engine + idle-time scheduler 



phase\_5



&nbsp;



git



Add/extend job types:



generate\_daily\_journal



Trigger: daily schedule OR after enough entries accumulate OR on user request.



Output: DailyJournalArtifact with citations.



generate\_monthly\_digest



Trigger: month boundary OR “close month” action.



Output: MonthlyDigestArtifact.



update\_current\_memory



Trigger: after daily journal completes.



Compares new daily info vs existing CurrentMemoryItems.



generate\_nudges



Trigger: on new entry, on idle insight, on app open, on daily/monthly artifact creation.



Produces notifications (not forced chat).



idle\_intelligence\_scan



Already conceptually in your system (“idle time intelligence”) → ensure it writes results as artifacts with provenance and only escalates to notifications based on gating.



notification\_compaction



If too many pending notifications, group them (“3 new insights about X”).



All jobs must:



be idempotent



be auditable



not create duplicates



obey throttling 



phase\_5



14\) MainChat Context Loading Strategy (So It Doesn’t Get “Heavy”)



You worried about dumping everything into context (correct fear).



So MainChat should build a Context Pack:



On chat start (contextful mode)



Pending notifications (titles + tiny summaries + refs)



Current month digest



Last N daily journals (N bounded)



Optionally: previous month digest



Optional “top goals” for active scope



On demand retrieval (as user asks)



Use search (Phase 12 FTS) to pull relevant entries/artifacts when needed 



phase\_11



Use links graph to jump related items quickly 



phase\_8



Budgeting



Always cap how much text is injected.



Prefer summaries + citations, and only pull raw entries when required.



15\) Research Loader (Auto-populate a pot from topic)



You mentioned:



user enters topic



system creates a pot



system crawls internet and populates it



This is real, but it’s a separate feature chunk (and riskier: crawling, SSRF, ToS, costs).

So plan it as:



Phase later / feature flag



uses strict fetch rules



stores sources with provenance



runs the same tagging/linking pipeline



You already have the security mindset to do this safely 



phase\_2



16\) Settings UX (You insisted, correctly)



Everything you described must be controllable:



Global toggles



Proactive chat on open: on/off



Idle intelligence: on/off



Notification types: on/off per type



Tone: dial



Skill level: dial



Default start mode: contextful vs free-flow



Model selection: default + per-task overrides



Per-pot overrides



Allow AI to access this pot: yes/no



Allow proactive nudges for this pot: yes/no



Goal statement + goal tags



Sensitivity (e.g., strict casework mode later) 



phase\_7



17\) QA / Proof It Works (Non-negotiable)



Follow your own “no trust me bro” doctrine 



logging



&nbsp;



qa



Required QA scenarios



PotChat remains unchanged and passes existing UI behavior checks.



MainChat opens in:



contextful mode (loads notifications/digests)



free-flow mode (loads nothing)



Notifications:



created



persist if not clicked



injected next time



dismissed/snoozed works



cooldown prevents spam



Daily journals:



generated



include citations



locked + annotations allowed



Monthly digest:



generated from daily journals



current month updates, older months archived



Idle intelligence:



only alerts when gating passes



creates “while you were away” item



Model prefs:



default model works



per-task override works



provenance recorded



Logging / audit



Every nudge has:



why it triggered (scores + rule path)



what it references (IDs)



what model/prompt was used



No secrets in logs 



phase\_2



&nbsp;



phase\_5



18\) Implementation Order (So You Don’t Build a Tower of Glass)



Do it in slices that can ship:



Slice 1 — Clone UI safely



Clone PotChat UI into MainChat module.



Confirm MainChat can render and send messages without touching PotChat.



Slice 2 — Notification inbox (no proactivity yet)



Add notifications UI + persistence + “open in chat”.



Slice 3 — App-open context injection



Contextful vs Free-flow start.



Inject pending notifications into session.



Slice 4 — Proactive nudges (minimal)



Greeting + “you added stuff” triage with strict cooldowns.



Slice 5 — Daily journal artifact (citations enforced)



Generate daily journals and attach to scope/pots.



Slice 6 — Monthly digest + rolling archive



Current month live, past months frozen.



Slice 7 — Idle intelligence → “gold-only” alerts



Hook your existing idle intelligence outputs into notification generation.



Slice 8 — CurrentMemory updater (evolving memory)



Replaceable “latest state” items + contradiction detection.



Slice 9 — Research loader (optional later)



Only when the rest is stable and hardened.



19\) What The IDE-Model Should Do Next (Your instruction to it)



When you pass this to the code-aware model, tell it:



Find PotChat UI module and its boundaries.



Clone it to MainChat area (new module namespace).



Identify:



state management approach



message pipeline



context injection mechanism



persistence layer for chat sessions (if any)



Implement features in the slice order above.



Add tests and a smoke checklist for each slice.



Do not refactor PotChat while doing this—only reuse patterns.

