import type {
  BudgetConflict,
  Fragment,
  OmittedFragment,
  OmissionReason,
  SelectedFragment,
  TokenEstimator,
  Warning,
} from './types.js';

/** Output of the selection stage. */
export interface SelectionResult {
  selected: SelectedFragment[];
  omitted: OmittedFragment[];
  budget: {
    requested: number;
    used: number;
    fitsBudget: boolean;
    conflict?: BudgetConflict;
  };
  warnings: Warning[];
}

/** Estimate the token cost of a rendered fragment block (text + overhead). */
export function fragmentCost(f: Fragment, estimator: TokenEstimator): number {
  return estimator.estimate(f.text) + 12; // header + source tag overhead
}

/**
 * Truncate text to fit within a token budget, preserving whole lines.
 * Returns the truncated text and a human-readable note, or null if the text
 * already fits within the budget.
 */
export function truncateText(
  text: string,
  estimator: TokenEstimator,
  maxTokens: number,
): { text: string; note: string } | null {
  if (estimator.estimate(text) <= maxTokens) return null;

  // Preserve whole lines while staying within budget.
  const lines = text.split('\n');
  let accumulated = '';
  let accTokens = 0;

  for (const line of lines) {
    const test = accumulated + line + '\n';
    const testTokens = estimator.estimate(test);
    if (testTokens <= maxTokens) {
      accumulated = test;
      accTokens = testTokens;
    } else {
      break;
    }
  }

  if (!accumulated) {
    // Even one line doesn't fit — truncate at char level.
    const charBudget = Math.floor(
      (maxTokens / Math.max(1, estimator.estimate(text))) * text.length,
    );
    if (charBudget < 20) return null; // too small to be useful
    accumulated = text.slice(0, charBudget);
    accTokens = estimator.estimate(accumulated);
  }

  const dropped = estimator.estimate(text) - accTokens;
  const note = `truncated (\u2248${Math.round(dropped)} tokens dropped)`;
  return { text: accumulated, note };
}

/**
 * Stage 5b: truncation fill.
 *
 * After the greedy fill, if there's remaining budget, try to fit truncated
 * versions of high-scoring omitted fragments. This salvages relevance from
 * fragments that were too large to include whole.
 *
 * Only one truncated fragment is taken per omitted record group (preserving
 * the "keep whole records together" invariant for non-truncated content).
 */
function truncateFill(
  groups: Array<{
    id: string;
    fragments: Fragment[];
    mandatory: boolean;
    superseded: boolean;
    maxScore: number;
    cost: number;
    firstIndex: number;
  }>,
  selectedIds: Set<string>,
  selected: SelectedFragment[],
  omitted: OmittedFragment[],
  remaining: { value: number },
  estimator: TokenEstimator,
): Warning[] {
  const warnings: Warning[] = [];
  const overhead = 12;

  // Omitted groups sorted by max score (deterministic via firstIndex tiebreak).
  const omittedGroups = groups
    .filter((g) => !g.mandatory && !g.superseded)
    .filter((g) => g.fragments.some((f) => !selectedIds.has(f.id)))
    .map((g) => ({ group: g, density: g.cost > 0 ? g.maxScore / g.cost : 0 }))
    .sort(
      (a, b) =>
        b.group.maxScore - a.group.maxScore ||
        b.density - a.density ||
        a.group.firstIndex - b.group.firstIndex,
    );

  for (const { group: g } of omittedGroups) {
    if (remaining.value < overhead + 5) break;

    // Highest-scoring unselected fragment in this group.
    const candidate = g.fragments
      .filter((f) => !selectedIds.has(f.id))
      .sort(
        (a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0) || (a.id < b.id ? -1 : 1),
      )[0];
    if (!candidate) continue;

    const fullCost = fragmentCost(candidate, estimator);
    if (fullCost <= remaining.value) continue;

    // Try to fit a truncated version.
    const maxTokens = Math.floor(remaining.value * 0.9);
    const truncated = truncateText(candidate.text, estimator, maxTokens);
    if (!truncated) continue;

    const truncCost = estimator.estimate(truncated.text) + overhead;
    if (truncCost > remaining.value) continue;

    selectedIds.add(candidate.id);
    selected.push({
      fragment: { ...candidate, text: truncated.text },
      selectionReason: 'truncated',
      truncated: true,
      truncationNote: truncated.note,
    });
    remaining.value -= truncCost;
    warnings.push({
      code: 'TRUNCATED',
      message: `Fragment ${candidate.id} truncated to fit budget (${truncated.note}).`,
    });

    // Remove from omitted.
    const idx = omitted.findIndex((o) => o.id === candidate.id);
    if (idx >= 0) omitted.splice(idx, 1);

    break;
  }

  return warnings;
}

/**
 * Stage 5: budget-aware deterministic selection.
 *
 * - Fragments are grouped by record so structured records are never split.
 * - Mandatory fragments (accepted constraints/decisions, task-critical
 *   evidence) are always included; an infeasible budget is reported as a
 *   conflict instead of silently dropping facts.
 * - Remaining budget is filled greedily by score/token density with
 *   deterministic tie-breaking (input order).
 */
export function selectStage(
  fragments: Fragment[],
  opts: {
    taskTokens: number;
    budget: number;
    estimator: TokenEstimator;
  },
): SelectionResult {
  const warnings: Warning[] = [];
  const { taskTokens, budget, estimator } = opts;

  // Group by record, preserving input order inside groups.
  const groups = new Map<string, Fragment[]>();
  for (const f of [...fragments].sort((a, b) => a.recordIndex - b.recordIndex || (a.id < b.id ? -1 : 1))) {
    const g = groups.get(f.recordId);
    if (g) g.push(f);
    else groups.set(f.recordId, [f]);
  }

  interface Group {
    id: string;
    fragments: Fragment[];
    mandatory: boolean;
    superseded: boolean;
    maxScore: number;
    cost: number;
    firstIndex: number;
  }
  const allGroups: Group[] = [...groups.entries()].map(([recordId, fs]) => ({
    id: recordId,
    fragments: fs,
    mandatory: fs.some((f) => f.mandatory === true),
    superseded:
      fs.every((f) => f.kind === 'decision' && (f.meta?.decisionStatus === 'superseded' || f.meta?.decisionStatus === 'rejected')),
    maxScore: Math.max(...fs.map((f) => f.score?.total ?? 0)),
    cost: fs.reduce((acc, f) => acc + fragmentCost(f, estimator), 0),
    firstIndex: Math.min(...fs.map((f) => f.recordIndex)),
  }));

  const selectedIds = new Set<string>();
  const selected: SelectedFragment[] = [];
  const omitted: OmittedFragment[] = [];

  // 1. Mandatory groups first, in input order.
  const mandatoryGroups = allGroups.filter((g) => g.mandatory && !g.superseded);
  const mandatoryCost = mandatoryGroups.reduce((acc, g) => acc + g.cost, 0);
  let used = taskTokens;
  const overflow: NonNullable<BudgetConflict['overflow']> = [];
  for (const g of mandatoryGroups) {
    for (const f of g.fragments) {
      selectedIds.add(f.id);
      selected.push({
        fragment: f,
        selectionReason: f === g.fragments[0] ? 'mandatory' : 'related_to_selected',
      });
    }
    used += g.cost;
    if (used > budget) {
      overflow.push({
        fragmentId: g.fragments[0]?.id ?? g.id,
        label: g.fragments[0]?.provenance.source.label ?? g.id,
        tokens: g.cost,
      });
    }
  }

  let conflict: BudgetConflict | undefined;
  if (overflow.length > 0) {
    conflict = {
      mandatoryTokens: taskTokens + mandatoryCost,
      budget,
      overflow,
      message: `Mandatory content (${taskTokens + mandatoryCost} tokens est.) exceeds the requested budget (${budget}). All mandatory fragments were still included; reduce scope or raise the budget.`,
    };
    warnings.push({ code: 'BUDGET_CONFLICT', message: conflict.message });
  }

  // 2. Greedy fill by score/token density with deterministic tie-breaking.
  let remaining = Math.max(0, budget - used);
  const candidates = allGroups
    .filter((g) => !g.mandatory && !g.superseded)
    .map((g) => ({ group: g, density: g.cost > 0 ? g.maxScore / g.cost : 0 }))
    .sort(
      (a, b) =>
        b.density - a.density ||
        b.group.maxScore - a.group.maxScore ||
        a.group.firstIndex - b.group.firstIndex,
    );

  const considered: Array<{ group: Group; fits: boolean }> = [];
  for (const { group: g } of candidates) {
    if (g.cost <= remaining) {
      remaining -= g.cost;
      used += g.cost;
      for (const f of g.fragments) {
        selectedIds.add(f.id);
        const top = g.fragments.reduce((best, f2) =>
          (f2.score?.total ?? 0) > (best.score?.total ?? 0) ? f2 : best,
        );
        selected.push({
          fragment: f,
          selectionReason: f === top ? 'high_relevance' : 'related_to_selected',
        });
      }
      considered.push({ group: g, fits: true });
    } else {
      considered.push({ group: g, fits: false });
    }
  }

  // 2b. Truncation fill: salvage high-scoring omitted fragments by truncating text.
  const remainingObj = { value: remaining };
  warnings.push(
    ...truncateFill(allGroups, selectedIds, selected, omitted, remainingObj, estimator),
  );
  remaining = remainingObj.value;
  used = budget - remaining;

  // 3. Omissions with reasons.
  const minSelectedScore = selected.reduce(
    (min, s) => Math.min(min, s.fragment.score?.total ?? Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );
  const finiteMin = Number.isFinite(minSelectedScore) ? minSelectedScore : 0;
  for (const { group: g, fits } of considered) {
    const score = g.maxScore;
    const reason: OmissionReason =
      !fits && score >= finiteMin && remaining === 0 ? 'budget_exhausted' : 'low_relevance';
    for (const f of g.fragments) {
      if (!selectedIds.has(f.id)) omitted.push(makeOmitted(f, reason));
    }
  }
  for (const g of allGroups.filter((g) => g.superseded && !g.mandatory)) {
    for (const f of g.fragments) {
      if (!selectedIds.has(f.id)) omitted.push(makeOmitted(f, 'superseded'));
    }
  }
  omitted.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 4. Render order for selected: by input order, then fragment id.
  selected.sort(
    (a, b) =>
      a.fragment.recordIndex - b.fragment.recordIndex || (a.fragment.id < b.fragment.id ? -1 : 1),
  );

  const fitsBudget = used <= budget && overflow.length === 0;
  if (!fitsBudget && overflow.length === 0) {
    warnings.push({
      code: 'BUDGET_EXCEEDED',
      message: `Estimated output (${used}) exceeds the budget (${budget}).`,
    });
  }

  return {
    selected,
    omitted,
    budget: {
      requested: budget,
      used,
      fitsBudget,
      ...(conflict ? { conflict } : {}),
    },
    warnings,
  };
}

function makeOmitted(f: Fragment, reason: OmissionReason): OmittedFragment {
  return {
    id: f.id,
    recordId: f.recordId,
    kind: f.kind,
    preview: f.text.slice(0, 120),
    reason,
    ...(f.score ? { score: f.score.total } : {}),
  };
}


