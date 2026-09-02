/** Core domain types for Urban Planning Copilot */

export type ProvenanceKind =
  | "source_data"
  | "calculated"
  | "copilot_recommendation"
  | "planner_decision";

export type DatasetKind =
  | "parcels"
  | "transit"
  | "flood"
  | "population"
  | "infrastructure"
  | "zoning"
  | "schools"
  | "parks"
  | "roads"
  | "custom";

export type AnalysisStatus =
  | "idle"
  | "plan_ready"
  | "running"
  | "completed"
  | "failed"
  | "stale"
  | "cancelled";

export type ScenarioStatus = "draft" | "saved" | "archived";

export type DecisionStatus =
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | "changes_requested";

export type ConstraintOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gte"
  | "lte"
  | "within_distance"
  | "outside"
  | "intersects"
  | "not_intersects"
  | "contains"
  | "within_geometry"
  | "excluded_ids";

export type PlanningIntent =
  | "housing_capacity"
  | "emergency_shelter"
  | "school_accessibility"
  | "park_accessibility"
  | "service_access"
  | "transit_gap"
  | "climate_resilience"
  | "generic_siting"
  | "explore";

export type ServiceAccessType = "school" | "park";

export type AnalysisUnit = "parcel" | "neighborhood";

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapViewport {
  center: [number, number];
  zoom: number;
  bounds?: BoundingBox;
}

export interface DatasetMeta {
  id: string;
  name: string;
  kind: DatasetKind;
  source: string;
  version: string;
  /** When this dataset record was last synced in the catalog (not data vintage). */
  updatedAt: string;
  /** Observed or published vintage of the underlying data. */
  dataVintage?: string;
  synthetic: boolean;
  coverage: string;
  limitations: string[];
  featureCount: number;
  stale?: boolean;
  enabled: boolean;
  incompleteCoverage?: boolean;
  attributes: string[];
}

export interface Constraint {
  id: string;
  label: string;
  datasetKind?: DatasetKind;
  attribute?: string;
  operator: ConstraintOperator;
  value?: string | number | string[] | number[];
  geometryId?: string;
  hard: boolean;
  enabled: boolean;
}

export interface CriterionWeight {
  id: string;
  key: string;
  label: string;
  weight: number; // 0-1, should sum ~1
}

export interface Assumption {
  id: string;
  key: string;
  label: string;
  value: number | string | boolean;
  unit?: string;
  description: string;
  editable: boolean;
}

export interface PlanningObjective {
  rawText: string;
  intent: PlanningIntent;
  targetValue?: number;
  targetUnit?: string;
  geographyLabel: string;
  parsedRequirements: string[];
  confidence: number;
  qualityWarning?: string;
  /** True when the objective explicitly disclaims housing production. */
  excludesHousing?: boolean;
  /** Service types referenced in a multi-service access study. */
  serviceTypes?: ServiceAccessType[];
  /** Geographic unit named in the objective (analysis may still rank parcels). */
  analysisUnit?: AnalysisUnit;
  /** Datasets referenced but unavailable — partial analysis only. */
  dataGaps?: string[];
}

export interface AnalysisPlanStep {
  id: string;
  order: number;
  operation: string;
  label: string;
  purpose: string;
  datasets: string[];
  assumptions: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export interface AnalysisPlan {
  id: string;
  summary: string;
  steps: AnalysisPlanStep[];
  datasets: string[];
  constraints: string[];
  assumptions: string[];
  createdAt: string;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number;
  unit?: string;
  kind: ProvenanceKind;
  method?: string;
  inputs?: Record<string, unknown>;
  assumptions?: string[];
}

export interface CandidateProvenance {
  scoreBreakdown: Record<string, number>;
  calculations: Array<{
    name: string;
    method: string;
    inputs: Record<string, unknown>;
    output: number | string;
  }>;
  datasets: string[];
  assumptions: string[];
  constraints: string[];
  humanDecisions: string[];
  limitations: string[];
}

export interface Candidate {
  id: string;
  label: string;
  featureIds: string[];
  geometry: GeoJSON.Geometry;
  centroid: [number, number];
  score: number;
  rank: number;
  metrics: MetricValue[];
  provenance: CandidateProvenance;
  status: "eligible" | "excluded" | "rejected" | "preferred";
  rejectionReason?: string;
  recommendationNote?: string;
}

export interface AnalysisStepLog {
  step: string;
  detail: string;
  count?: number;
}

export interface AnalysisResult {
  id: string;
  jobId: string;
  scenarioId: string;
  status: AnalysisStatus;
  createdAt: string;
  completedAt?: string;
  candidates: Candidate[];
  aggregateMetrics: MetricValue[];
  summary: string;
  limitations: string[];
  stepLogs?: AnalysisStepLog[];
  stale: boolean;
  staleReason?: string;
  error?: string;
  configHash: string;
}

export interface AnalysisJob {
  id: string;
  scenarioId: string;
  status: AnalysisStatus;
  planId: string;
  startedAt: string;
  completedAt?: string;
  progress: number;
  currentStep?: string;
  activityIds: string[];
  configHash: string;
  error?: string;
}

export interface GeographicSelection {
  id: string;
  type: "exclusion" | "inclusion" | "focus";
  label: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  createdBy: "human" | "agent";
  createdAt: string;
}

export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: ScenarioStatus;
  parentScenarioId?: string;
  objective: PlanningObjective;
  constraints: Constraint[];
  weights: CriterionWeight[];
  assumptions: Assumption[];
  geographicSelections: GeographicSelection[];
  enabledDatasetIds: string[];
  analysisPlan?: AnalysisPlan;
  latestResultId?: string;
  decisionStatus: DecisionStatus;
  /** True when an approval no longer matches current inputs or results. */
  decisionStale?: boolean;
  decisionStaleReason?: string;
  /** Config hash + result id the approval was recorded against. */
  approvedAgainstConfigHash?: string;
  approvedAgainstResultId?: string;
  preferredCandidateId?: string;
  createdAt: string;
  updatedAt: string;
  savedAt?: string;
  annotations: Array<{ id: string; text: string; createdAt: string }>;
}

export interface HumanDecision {
  id: string;
  projectId: string;
  scenarioId: string;
  type:
    | "approve_scenario"
    | "reject_scenario"
    | "request_changes"
    | "reject_candidate"
    | "prefer_candidate"
    | "prefer_scenario"
    | "confirm_change"
    | "reject_change";
  subjectId?: string;
  reason?: string;
  actor: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ConfirmationRequest {
  id: string;
  projectId: string;
  scenarioId: string;
  title: string;
  description: string;
  impact: Record<string, string | number>;
  status: "pending" | "approved" | "modified" | "rejected";
  proposedAction: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string;
}

/** Agent-staged change awaiting explicit human approval (revision-bound). */
export interface StagedProposal {
  id: string;
  projectId: string;
  scenarioId: string;
  title: string;
  description: string;
  /** Domain action applied on approval (e.g. update_weights, update_constraints). */
  action: string;
  payload: Record<string, unknown>;
  /** Scenario configHash when the proposal was staged. */
  baseRevision: string;
  status: "pending" | "approved" | "rejected" | "stale";
  createdAt: string;
  createdBy: "agent" | "human";
  resolvedAt?: string;
  receiptSha256?: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  scenarioId?: string;
  actor: "human" | "agent" | "system";
  category:
    | "objective"
    | "constraint"
    | "analysis"
    | "map"
    | "scenario"
    | "decision"
    | "data"
    | "report"
    | "agent";
  action: string;
  summary: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  relatedDatasetIds?: string[];
  relatedCandidateIds?: string[];
  timestamp: string;
}

export interface LayerVisibility {
  datasetId: string;
  visible: boolean;
}

export interface MapState {
  viewport: MapViewport;
  layers: LayerVisibility[];
  selectedFeatureIds: string[];
  selectedCandidateId?: string;
  /** Scenario the selected candidate belongs to — prevents cross-scenario selection bleed. */
  selectedCandidateScenarioId?: string;
  highlightFeatureIds: string[];
  drawingMode?: "none" | "exclude" | "include" | "select";
  /** Evidence tab "show on map" focus for a dataset layer. */
  focusDatasetId?: string;
}

export interface Report {
  id: string;
  projectId: string;
  scenarioIds: string[];
  title: string;
  audience: string;
  createdAt: string;
  sections: Array<{
    heading: string;
    kind: ProvenanceKind | "methodology" | "limitations" | "comparison";
    body: string;
    data?: unknown;
  }>;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  activeScenarioId?: string;
  geographyLabel: string;
  mapState: MapState;
  mode: "explore" | "planning";
  resumeNote?: string;
}

export interface ProjectListItem {
  id: string;
  name: string;
  updatedAt: string;
  lastOpenedAt?: string;
  resumeNote?: string;
  geographyLabel: string;
}

export interface WorkspaceSnapshot {
  project: Project;
  scenarios: Scenario[];
  decisions: HumanDecision[];
  activities: ActivityEvent[];
  confirmations: ConfirmationRequest[];
  proposals: StagedProposal[];
  analysisJobs: AnalysisJob[];
  analysisResults: AnalysisResult[];
  reports: Report[];
  datasets: DatasetMeta[];
}

export interface AppStore {
  version: number;
  projects: Project[];
  scenarios: Scenario[];
  decisions: HumanDecision[];
  activities: ActivityEvent[];
  confirmations: ConfirmationRequest[];
  proposals: StagedProposal[];
  analysisJobs: AnalysisJob[];
  analysisResults: AnalysisResult[];
  reports: Report[];
  datasets: DatasetMeta[];
  featuresByDataset: Record<string, GeoJSON.FeatureCollection>;
}
