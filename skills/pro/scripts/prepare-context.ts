#!/usr/bin/env node
/**
 * prepare-context.ts - Pro feature: Prepares records from files before calling build_context
 * 
 * Usage: npx tsx scripts/prepare-context.ts <file1> <file2> ... [--task "Task description"]
 * 
 * This script reads specified files and generates ready-to-use record objects
 * for ingest_records or build_context tools.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FileRecord {
  kind: 'file';
  path: string;
  content: string;
  language: string;
}

const args: string[] = process.argv.slice(2);
const taskIndex = args.indexOf('--task');
const task: string = taskIndex > -1 ? args[taskIndex + 1] : 'Analyze the following code files';
const files: string[] = args.filter(a => !a.startsWith('--') && (taskIndex === -1 || a !== args[taskIndex + 1]));

if (files.length === 0) {
  console.error('Usage: npx tsx scripts/prepare-context.ts <file1> <file2> ... [--task "Task description"]');
  process.exit(1);
}

console.log('---');
console.log('title: Preparing context records');
console.log('tags: [workflow]');
console.log('---\n');

console.log(`Task: "${task}"\n`);
console.log('Records to ingest:');

const records: FileRecord[] = [];

files.forEach((file: string) => {
  const content = readFileSync(resolve(file), 'utf-8');
  const record: FileRecord = {
    kind: 'file',
    path: file,
    content: content.substring(0, 500) + (content.length > 500 ? '... (truncated)' : ''),
    language: file.split('.').pop() || 'unknown'
  };
  records.push(record);
  console.log(JSON.stringify(record, null, 2));
});

console.log('\n---');
console.log('title: Ready to build context');
console.log('---');
console.log('\nNext steps:');
console.log('1. Call `ingest_records` with the records above');
console.log('2. Call `build_context` with your task description');
console.log('3. Inspect the optimized context, sources, and omissions');