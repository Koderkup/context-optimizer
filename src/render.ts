import type { Fragment, RecordKind, SelectedFragment } from './types.js';

/** Section layout of the rendered context (fixed order for determinism). */
const SECTIONS: Array<{ title: string; kinds: ReadonlySet<RecordKind> }> = [
  {
    title: 'Constraints & Decisions',
    kinds: new Set<RecordKind>(['decision']),
  },
  {
    title: 'Errors & Failed Attempts',
    kinds: new Set<RecordKind>(['error']),
  },
  {
    title: 'Test Results',
    kinds: new Set<RecordKind>(['test_result']),
  },
  {
    title: 'Files & Diffs',
    kinds: new Set<RecordKind>(['file', 'diff']),
  },
  {
    title: 'Conversation & Tool Output',
    kinds: new Set<RecordKind>(['message', 'tool_call']),
  },
  {
    title: 'Notes',
    kinds: new Set<RecordKind>(['note']),
  },
];

/** Default options for source tags. */
export interface SourceTagOptions {
  /** When true, emit a compact tag with just the fragment id. */
  compact: boolean;
}

/**
 * Compact source tag kept with every rendered fragment.
 *
 * Full format:  `[source: fr_xxx | r0 | src/path.ts | +N]`
 * Compact format: `[source: fr_xxx]`  (just the id; provenance in report)
 *
 * The full format includes the record id, file path (when available), and
 * merged count so the tag is self-describing inline. The compact format
 * minimises per-fragment overhead when budget is tight.
 */
export function sourceTag(f: Fragment, opts?: Partial<SourceTagOptions>): string {
  const compact = opts?.compact ?? false;
  if (compact) {
    return `[source: ${f.id}]`;
  }
  const parts = [f.id, `record ${f.recordId}`];
  if (f.provenance.source.path) parts.push(f.provenance.source.path);
  const merged = f.provenance.mergedFrom.length - 1;
  if (merged > 0) parts.push(`+${merged}`);
  return `[source: ${parts.join(' | ')}]`;
}

function renderFragment(f: Fragment, tagOpts?: Partial<SourceTagOptions>): string {
  const dupNote = f.duplicateCount > 1 ? ` (x${f.duplicateCount})` : '';
  return `### ${f.kind}${dupNote} - ${f.provenance.source.label}\n${f.text}\n${sourceTag(f, tagOpts)}`;
}

/** Rendering options. */
export interface RenderOptions {
  /** Use compact source tags (shorter provenance markers). */
  compactSourceTags?: boolean;
}

/**
 * Stage 6: render the selected fragments into the compact context text.
 * Sections appear in a fixed order; fragments inside sections follow input
 * order. The task is rendered as the header and is always present.
 */
export function renderContext(
  task: string,
  selected: SelectedFragment[],
  opts?: RenderOptions,
): string {
  const tagOpts: Partial<SourceTagOptions> = opts?.compactSourceTags ? { compact: true } : {};
  const blocks: string[] = [`# Task\n\n${task.trim()}`];
  for (const section of SECTIONS) {
    const inSection = selected.filter((s) => section.kinds.has(s.fragment.kind));
    if (inSection.length === 0) continue;
    const rendered = inSection.map((s) => renderFragment(s.fragment, tagOpts)).join('\n\n');
    blocks.push(`## ${section.title}\n\n${rendered}`);
  }
  return blocks.join('\n\n');
}
