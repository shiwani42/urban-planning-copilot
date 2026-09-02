# URBAN PLANNING COPILOT

## End-to-End Evaluation Specification

These evaluations determine whether the implementation is a real product rather than a polished demo.

The evaluator should test the running application using normal user interactions and, where appropriate, the exposed WebMCP tools.

A solution should not pass because it reproduces the supplied screenshots.

It must pass because the underlying system behaves correctly.

---

# Evaluation philosophy

Evaluate five dimensions:

1. **Product functionality**
2. **Human + AI collaboration**
3. **WebMCP quality**
4. **Trust / provenance / correctness**
5. **Generalization / engineering robustness**

Visual fidelity is evaluated separately but is important.

---

# EVAL 1 — Project lifecycle

### Action

Create a new project.

Enter:

> North River Housing Strategy

Objective:

> Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.

### Expected

* project created
* objective persisted
* planning workspace opened
* objective visible in UI
* state survives refresh

### Failure

Any important state disappears after refresh.

---

# EVAL 2 — Natural-language planning objective

### Action

Enter:

> Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, while respecting residential zoning.

### Expected

System identifies appropriate conceptual requirements:

* housing target
* transit threshold
* flood exclusion
* zoning requirement

Agent proposes a structured analysis plan.

### Failure

The user must manually fill a large configuration form before the system can understand the request.

---

# EVAL 3 — Analysis plan transparency

Before running analysis, inspect the proposed plan.

### Expected

User can see:

* datasets
* constraints
* analyses
* assumptions
* purpose

User can modify/review them.

### Failure

Agent immediately performs opaque operations.

---

# EVAL 4 — Real spatial filtering

Run the analysis.

### Expected

Actual spatial operations occur.

For example:

* zoning filtering
* flood intersection
* transit proximity
* capacity estimation

Results correspond to underlying geometry/data.

### Failure

Results are predetermined constants.

---

# EVAL 5 — Map/result synchronization

Select a candidate in the result table.

### Expected

* candidate selected on map
* candidate detail updates
* relevant metrics update
* Copilot context updates

Then select another candidate on the map.

Expected corresponding table/detail selection.

### Failure

Map and table show independent fake state.

---

# EVAL 6 — Human geographic override

Human selects/draws a geographic exclusion area.

### Expected

* exclusion becomes part of planning state
* affected candidates are removed/changed
* relevant analysis becomes stale or reruns
* agent becomes aware of the change
* provenance records the human action

### Failure

The map visually changes but the analytical result does not.

---

# EVAL 7 — Human priority override

Initial weights:

```text
Transit: 45%
Capacity: 35%
Flood resilience: 20%
```

Change to:

```text
Transit: 20%
Capacity: 20%
Flood resilience: 60%
```

### Expected

* ranking recalculates
* score explanations change
* scenario reflects new weights
* previous scenario remains recoverable

### Failure

Ranking remains fixed.

---

# EVAL 8 — Scenario branching

Create Scenario A.

Duplicate it into Scenario B.

Change B.

### Expected

A remains unchanged.

B contains the modification.

Comparison reflects the difference.

### Failure

Changes to B mutate A.

---

# EVAL 9 — Scenario comparison

Create at least three scenarios with different:

* constraints
* weights
* assumptions

### Expected

Comparison provides:

* consistent metrics
* synchronized geographic context
* meaningful differences
* trade-offs

### Failure

Comparison is merely textual or hard-coded.

---

# EVAL 10 — Candidate evidence

Select a recommendation.

### Expected

User can inspect:

* score
* metrics
* calculations
* assumptions
* constraints
* datasets
* source/version
* limitations

### Failure

"AI recommends this" is the only explanation.

---

# EVAL 11 — Recommendation classification

Inspect the UI.

### Expected

The product clearly distinguishes:

**Source data**

**Calculated**

**Copilot recommendation**

**Planner decision**

### Failure

AI recommendation appears indistinguishable from measured fact.

---

# EVAL 12 — Provenance chain

For a candidate recommendation, trace:

```text
Candidate
↓
Score
↓
Calculation
↓
Inputs
↓
Dataset
↓
Assumption
↓
Constraint
```

### Expected

All relevant links are inspectable.

---

# EVAL 13 — Agent activity authenticity

Start analysis.

Observe agent activity.

### Expected

If UI says:

> Filtering 8,421 parcels

then an actual filtering operation occurred.

If UI says:

> Calculating transit accessibility

then an actual calculation occurred.

### Failure

Progress is merely animation or hard-coded text.

---

# EVAL 14 — WebMCP semantic operation

Use the WebMCP interface to perform a meaningful operation.

Example:

> Update the transit threshold to 500m.

### Expected

* structured tool invocation
* validated input
* application state changes
* UI updates
* subsequent analysis can use new state

### Failure

Tool only simulates a response.

---

# EVAL 15 — WebMCP independence from DOM

Change UI layout or component structure without changing the semantic application operation.

### Expected

WebMCP operation continues to work.

### Failure

Tool relies on:

* CSS selector
* DOM position
* button coordinates
* text scraping

---

# EVAL 16 — WebMCP state synchronization

Perform an operation through the UI.

Then inspect application state through WebMCP.

Perform a semantically equivalent operation through WebMCP.

Then inspect the UI.

### Expected

Both interfaces operate on the same state.

---

# EVAL 17 — Agent interruption

Start a long-running analysis.

While it is running, change a planning criterion.

### Expected

System identifies state change.

Potential result:

> "Planning criteria changed. Current results need recalculation."

The stale result must not silently remain authoritative.

---

# EVAL 18 — No feasible solution

Create constraints that produce zero valid candidates.

### Expected

System clearly reports:

> No feasible candidates found.

Agent may propose possible constraint relaxations.

Human chooses whether to change them.

### Failure

System invents plausible candidates.

---

# EVAL 19 — Missing data

Disable a required dataset.

Run analysis.

### Expected

System identifies missing data.

It explains:

* what is missing
* which analysis depends on it
* what cannot currently be calculated

### Failure

System produces fabricated or silently incomplete results.

---

# EVAL 20 — Stale data

Mark a relevant dataset as outdated.

### Expected

User can see:

* dataset freshness
* last update
* potential limitation

Relevant recommendations should reflect the limitation where appropriate.

---

# EVAL 21 — Data perturbation

Modify underlying dataset values.

Example:

Candidate A:

```text
capacity = 640
```

Change to:

```text
capacity = 300
```

Candidate B:

```text
capacity = 520
```

Change to:

```text
capacity = 900
```

### Expected

* metrics change
* ranking changes when mathematically appropriate
* map presentation changes where appropriate
* scenario comparison changes
* Copilot explanation changes

### Failure

UI continues displaying the original hard-coded answer.

---

# EVAL 22 — New geography

Replace the canonical geographic dataset with another compatible geography.

### Expected

System can:

* render it
* query it
* analyze it
* produce candidates
* visualize results
* create scenarios

### Failure

System only works around hard-coded demo coordinates.

---

# EVAL 23 — New planning objective: emergency shelters

Input:

> Identify three locations for emergency shelters that maximize population coverage, prioritize accessibility, and avoid flood-risk areas.

### Expected

The same application architecture adapts.

Agent identifies relevant:

* population
* roads/accessibility
* flood
* candidate geography

and produces a meaningful analysis.

### Failure

A separate emergency-shelter-specific implementation is required.

---

# EVAL 24 — New planning objective: schools

Input:

> Identify neighborhoods where a new school would most improve accessibility while avoiding areas already adequately served.

### Expected

Agent adapts analysis.

No housing-specific logic should be required.

---

# EVAL 25 — New planning objective: transit

Input:

> Find neighborhoods with the largest transit accessibility gaps and identify areas where a new transit stop could improve access.

### Expected

Agent combines relevant spatial data and analysis.

---

# EVAL 26 — Human rejection

Agent recommends Candidate A.

Human selects:

> Reject candidate.

Reason:

> Planned redevelopment already exists here.

### Expected

* rejection recorded
* candidate no longer treated as preferred
* agent can incorporate decision
* history records the human decision

### Failure

Agent silently reintroduces candidate A.

---

# EVAL 27 — Human override beats AI recommendation

Agent recommends Scenario A.

Human chooses Scenario B.

### Expected

Scenario B becomes the human-selected scenario.

The system must not override the human because the AI's numerical score is higher.

---

# EVAL 28 — Decision confirmation

Approve a scenario.

### Expected

User sees:

* scenario
* evidence summary
* assumptions
* limitations
* explicit approval action

Approval is recorded as a human decision.

---

# EVAL 29 — Persistence

Perform a substantial workflow.

Refresh browser.

Close application.

Reopen project.

### Expected

Restore:

* project
* scenario
* objective
* important constraints
* relevant results
* decisions
* activity/provenance

---

# EVAL 30 — Report correctness

Generate a report.

### Expected

Report contains:

* objective
* geography
* datasets
* assumptions
* methodology
* results
* scenario comparison
* limitations
* provenance
* human decision

### Failure

Report invents unsupported claims or omits critical assumptions.

---

# EVAL 31 — Calculation transparency

For a numerical metric, inspect its methodology.

### Expected

User can determine:

* inputs
* parameters
* method
* output

### Failure

Only a mysterious number is displayed.

---

# EVAL 32 — Assumption experiment

Change:

```text
Transit threshold:
800m → 500m
```

### Expected

User can preview/test the effect.

The application should show which results change.

The original saved scenario remains recoverable.

---

# EVAL 33 — Safe experimentation

Duplicate a scenario.

Make several changes.

Do not save.

### Expected

User can abandon the draft without corrupting the saved scenario.

---

# EVAL 34 — Activity history

Perform:

1. Human changes objective.
2. Agent runs analysis.
3. Human excludes area.
4. Agent recalculates.
5. Human rejects candidate.
6. Human selects scenario.

### Expected

Activity timeline preserves these events with:

* actor
* action
* time
* affected state

---

# EVAL 35 — Activity inspectability

Click an analysis event.

### Expected

Show:

* what happened
* inputs
* output
* affected state
* related dataset
* related scenario

Do not show private chain-of-thought.

---

# EVAL 36 — Failure integrity

Force an analysis failure.

### Expected

* failure visible
* current result not falsely presented as successful
* agent explains the problem
* retry/recovery possible

---

# EVAL 37 — Partial data

Provide a dataset with incomplete geographic coverage.

### Expected

System identifies coverage limitation.

Results indicate appropriate uncertainty/limitation.

---

# EVAL 38 — UI interaction authenticity

For every major control visible in the supplied Stitch designs:

Test it.

### Expected

It either:

* performs a meaningful action
* opens meaningful information
* changes real state
* or is clearly decorative

### Failure

Fake buttons/controls exist solely for visual appearance.

---

# EVAL 39 — Visual fidelity

Compare the running application against the supplied Stitch screens.

Evaluate:

* layout
* hierarchy
* navigation
* map prominence
* typography
* panel structure
* visual density
* spacing
* interaction states
* assets

The implementation does not need pixel-perfect reproduction.

It must preserve the intended product experience.

---

# EVAL 40 — Main workspace coherence

Navigate through:

```text
Planning setup
→ Analysis plan
→ Running analysis
→ Results
→ Candidate detail
→ Scenario
→ Comparison
→ Decision
```

### Expected

The user feels like they remain inside one coherent planning workspace.

### Failure

Each screen feels like an unrelated application.

---

# EVAL 41 — Return experience

Leave a project midway through analysis.

Return later.

### Expected

The application communicates:

* where the planner left off
* current scenario
* recent changes
* outstanding decisions
* data changes
* new findings where available

---

# EVAL 42 — Explore mode

Use Explore without creating a formal scenario.

Ask:

> Where are transit accessibility gaps largest?

### Expected

System can investigate and visualize the finding.

User can convert an interesting finding into a deeper analysis/project.

---

# EVAL 43 — Agent generality

Give the agent a planning objective it has never seen during development.

Do not provide a predefined workflow.

### Expected

Agent can compose available capabilities.

The system should fail gracefully if a required capability/data source does not exist.

---

# EVAL 44 — Tool generality

Inspect WebMCP tool definitions.

### Expected

Tools represent domain operations.

Good:

```text
calculateAccessibility
rankCandidates
createScenario
updatePlanningCriteria
```

Bad:

```text
clickButton
findElement
executeJavascript
clickAtCoordinates
```

---

# EVAL 45 — Security

Attempt to make the agent:

* execute arbitrary SQL
* execute arbitrary code
* access unauthorized data
* manipulate unsupported application state

### Expected

Requests are rejected safely.

---

# EVAL 46 — No hidden canonical path

Inspect the codebase for special handling of:

* "North River"
* exact demo coordinates
* exact candidate names
* exact housing target
* fixed ranking
* fixed scenario results

### Expected

Demo data may exist as seed data.

But application logic must not depend on it.

---

# EVAL 47 — Generalized data schema

Change dataset identifiers and ordering.

### Expected

The application still functions based on dataset metadata/contracts rather than assuming a fixed array index/name.

---

# EVAL 48 — Mathematical invariants

Where applicable, verify:

### Exclusion

A parcel excluded by a hard constraint cannot be ranked as eligible.

### Threshold

Reducing a maximum allowed distance cannot increase the set of features satisfying that distance condition.

### Scenario isolation

Editing Scenario B cannot alter Scenario A.

### Weight integrity

Scenario weights must satisfy defined constraints.

### Failure integrity

A failed analysis cannot create a successful result.

---

# EVAL 49 — Human decision integrity

If a planner explicitly rejects a recommendation:

The system must preserve that rejection.

The agent may explain why a rejected candidate might otherwise score highly, but it must not silently treat it as approved.

---

# EVAL 50 — Final end-to-end test

Perform the complete workflow:

```text
Create project
    ↓
Ask planning question
    ↓
Review analysis plan
    ↓
Run analysis
    ↓
Inspect agent activity
    ↓
Inspect results
    ↓
Inspect candidate evidence
    ↓
Change geographic constraint
    ↓
Recalculate
    ↓
Create Scenario A
    ↓
Create Scenario B
    ↓
Change Scenario B priorities
    ↓
Compare scenarios
    ↓
Reject one candidate
    ↓
Select preferred scenario
    ↓
Approve decision
    ↓
Generate report
    ↓
Reload project
    ↓
Verify state
```

### Final success condition

The workflow completes without:

* hard-coded outputs
* fake agent actions
* broken state synchronization
* lost human decisions
* stale results presented as current
* unexplained recommendations
* brittle UI automation

---

# Scoring

Score each dimension from 0–10.

## A. Product completeness — 20%

Can a planner actually complete useful work?

## B. Human + AI collaboration — 20%

Does the agent genuinely collaborate with the human rather than simply chat?

## C. WebMCP leverage — 15%

Are WebMCP tools semantic, useful, stateful, and genuinely integrated?

## D. Spatial correctness — 15%

Are GIS operations real, configurable, and reliable?

## E. Trust & provenance — 10%

Can users understand evidence, assumptions, calculations, limitations, and decisions?

## F. Generalization — 10%

Does the architecture work beyond the canonical housing scenario?

## G. UX / visual quality — 10%

Does the implementation faithfully realize the supplied Stitch design and feel like a coherent professional product?

---

# Automatic failure conditions

A build should be considered fundamentally invalid if any of these are true:

1. Core candidate results are hard-coded.
2. Agent activity is fake.
3. WebMCP is merely decorative.
4. The agent relies on DOM scraping/click automation.
5. Human map changes do not affect analysis.
6. Scenario branches mutate each other.
7. Missing data produces fabricated results.
8. Failed analyses appear successful.
9. AI recommendations are presented as authoritative facts.
10. The product only works for the canonical housing scenario.

---

# Final evaluator question

After using the application, answer:

> **If the supplied demo data and housing example were completely removed, would this still be a credible urban planning product?**

If the answer is yes, the architecture is likely sound.

If the answer is no, the implementation is too demo-specific.
