# URBAN PLANNING COPILOT

## Production Product & Engineering Specification

**Document status:** Implementation contract
**Primary implementation target:** Production-grade web application
**Design source:** Supplied Google Stitch screens, code, and assets
**Implementation agent:** Autonomous coding agent

---

# 1. Mission

Build **Urban Planning Copilot**, a production-grade AI-native urban planning workspace.

The product enables urban planners to investigate spatial questions, analyze geographic data, construct and compare planning scenarios, inspect evidence, collaborate with an AI agent, and make informed planning decisions.

The central product experience is:

> **Human planner + AI agent + spatial data + computation + interactive map + scenarios + evidence**

working together inside one persistent application.

This is not a chatbot with a map.

It is not a generic GIS dashboard with an AI sidebar.

It is a planning workspace in which the AI can meaningfully operate the same application the human is using.

---

# 2. Implementation priority

When making implementation decisions, optimize in this order:

1. Correctness
2. User experience
3. Generality
4. Trustworthiness
5. Maintainability
6. Performance
7. Visual fidelity
8. Implementation simplicity

Do not optimize for making one demo flow pass.

The system must work because the underlying abstractions are correct.

---

# 3. Design source of truth

The repository contains Google Stitch-generated:

* screens
* UI code
* images/assets
* visual layouts
* interaction concepts

Treat these as the **visual and interaction design reference**.

Preserve the intended:

* information hierarchy
* layout
* navigation
* visual language
* component relationships
* map dominance
* panel structure
* states
* interactions
* trust/provenance UX

However:

**Stitch-generated code is not the architectural source of truth.**

You are explicitly authorized to:

* refactor it
* replace components
* reorganize the codebase
* introduce proper domain architecture
* replace mock state
* remove duplicated logic
* replace brittle implementations

Do not preserve poor implementation decisions merely because Stitch generated them.

---

# 4. Product principles

## 4.1 Human remains responsible for decisions

The AI may:

* investigate
* calculate
* rank
* recommend
* explain
* simulate
* prepare

The human remains responsible for:

* priorities
* assumptions
* overrides
* acceptance/rejection
* consequential planning decisions

The product must communicate this distinction.

---

## 4.2 Evidence before conclusions

Every meaningful recommendation should be traceable to:

* source data
* calculations
* assumptions
* constraints
* criteria
* scenario configuration
* relevant human decisions

Never fabricate evidence.

Never display an unsupported numerical result as authoritative.

---

## 4.3 State is first-class

Important state must exist in explicit application/domain state.

Examples:

* workspace
* planning objective
* geography
* active layers
* selected features
* filters
* constraints
* weights
* assumptions
* analysis jobs
* analysis results
* scenarios
* candidate rankings
* human decisions
* agent actions
* provenance

Do not encode important state solely in:

* chat history
* DOM structure
* CSS classes
* URLs
* component-local hacks
* fixed coordinates

---

## 4.4 The AI is an observable collaborator

Users must be able to understand:

* what the agent is doing
* what data it is using
* what operation it performed
* what result it obtained
* what assumptions it used
* what remains uncertain
* when human input is needed

Do not expose private chain-of-thought.

Expose **observable actions, inputs, outputs, evidence, assumptions, and decisions**.

---

# 5. Primary user

Primary:

**Urban planner / planning analyst**

The initial product should feel suitable for a professional planning workflow.

Potential future users:

* transportation planners
* housing planners
* GIS analysts
* environmental planners
* municipal policy teams
* infrastructure planners
* consultants
* public-sector decision teams

---

# 6. Core workflow

The application must support this general workflow:

```text
Create workspace
        ↓
Define planning objective
        ↓
Understand objective
        ↓
Identify relevant data
        ↓
Construct analysis plan
        ↓
Human reviews plan
        ↓
Run spatial analysis
        ↓
Visualize results
        ↓
Inspect evidence
        ↓
Modify constraints / assumptions
        ↓
Recalculate
        ↓
Create scenarios
        ↓
Compare scenarios
        ↓
Human decision
        ↓
Record decision
        ↓
Generate report
        ↓
Return later and continue
```

The workflow must be interruptible.

Human changes made during or after agent work must be incorporated into application state.

---

# 7. Canonical planning problem

The primary example should support a problem such as:

> Identify areas capable of accommodating 2,000 additional homes while maximizing transit accessibility, avoiding flood-risk areas, respecting zoning constraints, and minimizing infrastructure burden.

This is a **representative use case**, not a hard-coded workflow.

The system must also work when the user changes:

* target housing units
* geography
* transit threshold
* zoning rules
* environmental constraints
* scoring weights
* parcel requirements
* infrastructure priorities

---

# 8. Main product areas

The product contains these major experiences.

## Projects

View existing planning projects and continue previous work.

## Explore

Investigate the city and discover spatial patterns without necessarily creating a formal scenario.

## Planning Workspace

The primary map-centric workspace.

## Analysis

Run and inspect spatial analysis.

## Scenarios

Create, modify, branch, and compare alternative planning futures.

## Data / Evidence

Inspect source data, versions, coverage, assumptions, methods, and limitations.

## Activity

Inspect human actions, agent actions, analyses, and important state transitions.

## Decision Review

Review a scenario and explicitly approve/reject/request changes.

## Reports

Generate professional planning reports from saved scenarios and evidence.

---

# 9. Main workspace UX

The primary workspace should use the supplied Stitch design as the visual reference.

Conceptually:

```text
┌────────────────────────────────────────────────────────────┐
│ Project / Scenario / Save / Activity / User                │
├──────────────┬───────────────────────────────┬─────────────┤
│              │                               │             │
│ Planning     │                               │ Copilot     │
│ Context      │             MAP               │             │
│              │                               │             │
│ Objective    │                               │ Activity    │
│ Constraints  │                               │ Findings    │
│ Layers       │                               │ Actions     │
│ Scenarios    │                               │             │
│              │                               │             │
├──────────────┴───────────────────────────────┴─────────────┤
│ Analysis / Results / Candidates / Evidence / Comparison    │
└────────────────────────────────────────────────────────────┘
```

Exact dimensions may follow the supplied designs.

---

# 10. Map requirements

The map is a primary application surface.

It must support:

* pan
* zoom
* layer visibility
* feature selection
* multi-selection
* feature inspection
* highlighting
* spatial filtering
* geographic drawing/selection
* candidate visualization
* scenario visualization
* annotations

Map state must synchronize with application state.

If a candidate is selected in a table, the map must select it.

If a candidate is selected on the map, the relevant analytical/detail UI must update.

Do not maintain separate fake representations.

---

# 11. Data model

Use a normalized domain model rather than coupling the application to one demo dataset.

At minimum support these conceptual datasets.

## Parcels

Potential attributes:

* parcel ID
* geometry
* area
* zoning
* land use
* existing development
* development parameters

## Transit

Potential attributes:

* station/stop ID
* geometry
* type
* service/frequency information

## Flood/environment

Potential attributes:

* geometry
* risk classification

## Population

Potential attributes:

* geographic unit
* population
* demographic indicators where available

## Infrastructure

Potential attributes:

* geometry
* type
* service information

Exact schemas are implementation-defined.

Use adapters or normalized contracts.

---

# 12. Data architecture

Use a separation similar to:

```text
External / Open / Synthetic Data
             ↓
      Data adapters
             ↓
   Normalized spatial model
             ↓
    Spatial analysis engine
             ↓
       Scenario engine
             ↓
   Application/domain state
             ↓
       UI / WebMCP / Agent
```

The frontend must not be the spatial computation engine.

Do not embed large datasets in source code.

Do not encode analysis results as constants.

---

# 13. Data sources

Architecture should be capable of supporting:

* GeoJSON
* Shapefile
* GeoPackage
* WFS
* ArcGIS REST
* GTFS
* OpenStreetMap-derived data
* municipal open-data APIs
* census/demographic datasets
* environmental datasets

Initial development may use:

* public/open datasets
* realistic synthetic data
* a combination

Synthetic data must be clearly distinguishable from real source data.

The architecture must make replacing synthetic data with real data possible without redesigning the product.

---

# 14. Spatial analysis engine

Implement reusable spatial operations.

At minimum:

## Spatial relationships

* intersects
* within
* contains
* outside
* distance
* nearest feature
* buffer
* spatial join

## Filtering

Support:

* zoning compatibility
* geographic boundaries
* minimum parcel size
* environmental exclusions
* distance thresholds
* infrastructure requirements

## Accessibility

Support configurable metrics such as:

* distance to transit
* percentage of population within a threshold
* average/median distance
* accessibility scores

## Capacity

Support configurable capacity estimation.

Conceptually:

```text
developable area
× allowable density
× configurable adjustments
```

Do not hard-code one universal planning formula.

Assumptions must be explicit.

## Ranking

Rank candidates based on configurable criteria and weights.

Expose the inputs to the user.

## Scenario comparison

Compare scenarios using consistent metrics.

---

# 15. Scenario architecture

A scenario is a persistent first-class object.

Conceptually:

```text
Scenario
├── objective
├── geographic extent
├── datasets
├── constraints
├── criteria
├── weights
├── assumptions
├── candidate results
├── metrics
├── annotations
├── provenance
├── version
└── decision state
```

Users must be able to:

* create
* save
* duplicate
* branch
* edit
* compare
* restore
* annotate

Editing one scenario must not silently mutate another.

---

# 16. Agent capabilities

The planning agent must be capable of:

### Understand

Interpret natural-language planning questions.

### Investigate

Identify relevant datasets and analyses.

### Plan

Construct an explicit analysis plan.

### Analyze

Invoke spatial operations.

### Explain

Explain measured results.

### Propose

Recommend candidates/scenarios.

### Adapt

Respond to human changes.

### Compare

Analyze scenario trade-offs.

### Prepare

Generate reports and decision summaries.

### Escalate

Ask the human when:

* intent is ambiguous
* assumptions are material
* constraints conflict
* data is insufficient
* an action is consequential

---

# 17. WebMCP architecture

WebMCP is a genuine application integration layer.

The agent should interact with the live planning application through structured semantic tools.

Do not expose arbitrary DOM manipulation.

Do not require:

* CSS selectors
* button coordinates
* screen scraping
* DOM guessing
* fixed click sequences

Tools should describe planning operations.

Possible tool categories:

## Workspace

* getWorkspaceState
* updatePlanningObjective

## Map

* getMapState
* setMapViewport
* toggleLayer
* selectFeatures
* highlightFeatures
* createGeographicSelection

## Data

* listAvailableLayers
* queryLayer
* inspectFeature

## Analysis

* runSpatialFilter
* calculateProximity
* calculateAccessibility
* estimateCapacity
* evaluateConstraints
* rankCandidates

## Scenario

* createScenario
* updateScenario
* compareScenarios
* saveScenario
* restoreScenario

## Human collaboration

* getHumanDecisions
* requestHumanDecision
* recordDecision

## Reporting

* generatePlanningSummary
* generateScenarioReport

These are examples, not immutable requirements.

Improve the tool model when justified.

The final tools must be:

* typed
* discoverable
* validated
* composable
* independently testable
* state-aware
* permission-aware where applicable

---

# 18. Application state and WebMCP

There must be one coherent application/domain state.

Conceptually:

```text
                    Application State
                    /              \
                   /                \
                 UI                WebMCP
                                    |
                                  Agent
```

Do not build separate independent states for:

* UI
* MCP
* agent

The WebMCP layer must operate against the same underlying domain/application services used by the UI.

---

# 19. Human confirmation

Support explicit confirmation gates for consequential actions.

Example:

```text
Proposed change

Exclude 126 parcels from the active scenario.

Impact:
Housing capacity: -18%
Candidate areas: 17 → 11

[Approve] [Modify] [Reject]
```

Confirmation must be represented in application state.

Do not make confirmation purely conversational.

---

# 20. Transparency UX

The application must distinguish:

### Source data

Facts originating from datasets.

### Calculated

Outputs produced by deterministic analysis.

### Copilot recommendation

AI interpretation or recommendation.

### Planner decision

Explicit human decision.

This distinction should be visible throughout the product.

---

# 21. Agent activity

Do not use vague:

> "AI is thinking..."

Instead expose activity such as:

> Filtering parcels by residential zoning

> Calculating distance to transit

> Excluding high-risk flood areas

> Ranking 17 candidate areas

Each operation may expose:

* operation
* inputs
* outputs
* source datasets
* assumptions
* timestamp
* affected state

Do not expose private model chain-of-thought.

---

# 22. Provenance

Users must be able to trace a recommendation.

For a candidate:

```text
Recommendation
    ↓
Metrics
    ↓
Calculations
    ↓
Inputs
    ↓
Datasets
    ↓
Assumptions
    ↓
Constraints
    ↓
Human decisions
```

The exact implementation is flexible.

The user-visible result must be auditable.

---

# 23. Data freshness

Every externally sourced dataset should expose, where available:

* source
* version
* timestamp
* geographic coverage
* known limitations

If data is stale or incomplete, the application must say so.

Never hide data limitations.

---

# 24. Errors and uncertainty

Explicitly handle:

* missing datasets
* incomplete coverage
* invalid geometry
* conflicting constraints
* analysis failures
* stale results
* unsupported operations
* ambiguous requests

A failed analysis must never appear as a successful result.

If results become stale because inputs changed, identify them as stale.

---

# 25. Concurrency and stale state

If the human changes criteria while an analysis is running:

* identify that application state changed
* determine whether the result is invalidated
* prevent stale results from being presented as current
* allow recalculation

Do not silently overwrite human changes.

---

# 26. Reports

Reports should contain:

* objective
* geographic scope
* methodology
* datasets
* data versions
* assumptions
* constraints
* results
* scenario comparison
* limitations
* provenance
* human decision

Clearly distinguish:

* measured result
* AI interpretation
* human decision

Reports must not present AI recommendations as authoritative planning decisions.

---

# 27. Persistence

A user must be able to:

1. create a project
2. perform analysis
3. modify it
4. save it
5. leave
6. return later
7. see the same state
8. continue from there

Persist:

* project
* scenarios
* analysis configurations
* results or reproducible references
* human decisions
* important activity/provenance

---

# 28. Security

Treat all model-generated input as untrusted.

Implement:

* schema validation
* authorization
* server-side validation
* safe query construction
* no arbitrary SQL from the model
* no arbitrary code execution
* appropriate rate limits
* audit logging

The agent must never receive unrestricted database access.

---

# 29. Performance

Interactive operations should feel immediate:

* selection
* layer toggles
* inspection
* viewport
* simple filtering

Heavy operations may be asynchronous:

* spatial joins
* accessibility analysis
* large ranking operations
* scenario generation

Expose meaningful progress.

The UI must remain usable while long operations execute.

---

# 30. Accessibility

Support:

* keyboard navigation
* readable tables
* accessible controls
* textual representations of map results
* accessible dialogs
* clear error states

Do not make color the sole encoding mechanism.

---

# 31. Observability

Log structured events for:

* agent requests
* tool calls
* analysis jobs
* state transitions
* errors
* confirmations
* decisions

Provide a planner-readable activity interface.

Developer logs may exist separately.

Do not expose sensitive information unnecessarily.

---

# 32. Anti-hardcoding requirements

The following are prohibited:

* hard-coded candidate rankings
* hard-coded demo coordinates
* hard-coded analysis results
* hard-coded scenario outputs
* objective-specific UI branches
* scripted agent sequences
* fixed click automation
* DOM-selector-dependent agent behavior
* fake progress
* fake tool results
* data embedded solely to make screenshots look correct
* hidden constants representing the canonical answer

Configuration is acceptable.

Domain rules are acceptable.

Seed/demo data is acceptable.

The distinction is:

**configuration/data/rules may be explicit; application behavior must not be secretly scripted around the demo.**

---

# 33. Generalization requirement

The system must support materially different planning questions through the same underlying architecture.

Examples:

### Housing

"Find areas for 2,000 additional homes."

### Emergency response

"Find three emergency shelter locations maximizing population coverage while avoiding flood-risk areas."

### Schools

"Identify areas where new schools would improve accessibility."

### Transit

"Find neighborhoods with significant transit accessibility gaps."

The system may require different datasets/analysis combinations.

It must not require separate bespoke application implementations.

---

# 34. UI implementation requirement

Every meaningful visual control supplied by the Stitch design must correspond to:

* real application state
* a real operation
* or intentionally decorative UI

Do not implement fake interactive controls.

Examples:

"Why this candidate?"
→ opens actual evidence.

"Test this assumption"
→ performs an actual scenario/analysis operation.

"Compare"
→ opens actual scenario comparison.

"Recalculate"
→ performs actual analysis.

Activity event
→ opens actual provenance.

Dataset
→ opens actual metadata.

---

# 35. State-driven UI

Do not implement screens as independent static pages.

UI states must emerge from application state.

Examples:

```text
analysis.status = ready
        ↓
analysis.status = running
        ↓
analysis.status = completed
```

and:

```text
decision.status = pending
        ↓
decision.status = approved
```

and:

```text
scenario.status = saved
        ↓
scenario.status = draft
        ↓
scenario.status = saved
```

---

# 36. Engineering freedom

You are free to choose:

* frontend framework
* backend framework
* database
* spatial database
* GIS engine
* map library
* state management
* job system
* agent runtime
* deployment model
* testing framework
* folder structure

Do not ask for approval for normal engineering decisions.

Choose the architecture that best satisfies the product and evaluation requirements.

When choosing between approaches, favor generalizable, maintainable solutions over shortcuts that only benefit the canonical demo.

---

# 37. Definition of done

A new planner can:

1. Create a project.
2. Enter a planning question naturally.
3. Review the generated analysis plan.
4. Run analysis.
5. Observe meaningful agent activity.
6. Inspect results on the map.
7. Inspect candidate evidence.
8. Change a constraint.
9. Recalculate.
10. Create a scenario.
11. Duplicate and modify it.
12. Compare scenarios.
13. Reject/approve recommendations.
14. Inspect provenance.
15. Save the project.
16. Return later.
17. Generate a professional report.

The same architecture must handle at least three materially different planning problems.

---

# 38. Final implementation principle

Build the **underlying planning system**, not the appearance of one.

If removing the canonical housing example causes the application to stop working, the implementation is too hard-coded.

If replacing the dataset causes the UI to break, the data architecture is too coupled.

If the AI cannot operate the live application through semantic tools, WebMCP is superficial.

If users cannot determine why a recommendation exists, the trust architecture is incomplete.

If a human change cannot propagate through the system and affect subsequent analysis, the collaboration model is incomplete.

The finished product should feel like:

> **A professional planning instrument with an unusually capable AI collaborator.**
