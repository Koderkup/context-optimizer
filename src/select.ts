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
      omitted.push(makeOmitted(f, reason));
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


