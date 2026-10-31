#!/usr/bin/env node
/**
 * analyze-report.ts - Pro feature: Visualizes optimization reports from build_context
 * 
 * Usage: npx tsx scripts/analyze-report.ts <report.json>
 * 
 * This script parses the optimization report and displays:
 * - Summary statistics
 * - Top retained fragments
 * - Omitted records and reasons
 * - Token budget utilization
 */

import { readFileSync } from 'node:fs';

interface ReportStats {
  reduction?: number;
  contextTokens?: number;
  tokenBudget?: number;
  utilization?: number;
}

interface ReportSource {
  kind?: string;
  selectionReason?: string;
  score?: number;
}

interface OmittedRecord {
  kind?: string;
  reason?: string;
}

interface OptimizationReport {
  stats?: ReportStats;
  sources?: ReportSource[];
  omitted?: OmittedRecord[];
  warnings?: string[];
}

const reportPath: string = process.argv[2];
const report: OptimizationReport = JSON.parse(readFileSync(reportPath, 'utf-8'));

console.log('=== Optimization Report Analysis ===\n');

// Summary
console.log('Summary:');
console.log(`  Reduction: ${report.stats?.reduction || 'N/A'}`);
console.log(`  Context size: ${report.stats?.contextTokens || 'N/A'} tokens`);
console.log(`  Budget: ${report.stats?.tokenBudget || 'N/A'} tokens`);
console.log(`  Utilized: ${report.stats?.utilization || 'N/A'}%\n`);

// Retained fragments
console.log('Top retained fragments:');
report.sources?.slice(0, 5).forEach((s: ReportSource, i: number) => {
  console.log(`  ${i + 1}. [${s.kind || 'unknown'}] ${s.selectionReason || 'Retained'} (score: ${s.score || 'N/A'})`);
});

// Omissions
console.log('\nOmitted records:');
report.omitted?.forEach((o: OmittedRecord) => {
  console.log(`  - [${o.kind || 'unknown'}] ${o.reason || 'Reason not specified'}`);
});

// Warnings
if (report.warnings && report.warnings.length > 0) {
  console.log('\nWarnings:');
  report.warnings.forEach((w: string) => {
    console.log(`  ⚠️  ${w}`);
  });
}

console.log('\n=== Analysis complete ===');