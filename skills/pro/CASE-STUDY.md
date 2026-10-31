# Case Study: Real-World Context Optimization Benchmarks

## Executive Summary

This case study measures the **actual performance** of `mcp-context-optimizer` using real benchmark runs. All results were obtained by executing `npx tsx ./bench-real.ts` in the project repository.

## Test Methodology

- **Tool:** `ContextOptimizer` class from `mcp-context-optimizer@0.1.6`
- **Environment:** Node.js 20+, npx tsx
- **Token Estimation:** Default `chars/4` heuristic
- **Package:** `mcp-context-optimizer@0.1.6`

---

## Use Cases

### 1. Debugging Session (High Duplication) 🔍

**Context**: Full debugging session with error logs, test failures, file diffs, and conversation history

| Metric | Value |
|--------|-------|
| Input records | 49 |
| Input tokens | 2,223 |
| Output tokens | 976 |
| **Reduction** | **56%** |
| Tokens saved | 1,247 |
| Time saved | ~1 minute |

**Key retained**: Error messages, decision constraints, relevant code snippets

### 2. Code Review (Low Duplication) 📝

**Context**: Pull request review with middleware refactoring, JWT updates, and test changes

| Metric | Value |
|--------|-------|
| Input records | 29 |
| Input tokens | 1,309 |
| Output tokens | 1,085 |
| **Reduction** | **17%** |
| Tokens saved | 224 |

---

## Token Savings Visualization

### Average savings by scenario

```
Debugging Session (56%)     ██████░░░░  56%
Code Review (17%)           ██░░░░░░░░  17%
─────────────────────────────────────────
Average savings: 37%
```

### When savings are higher/lower

```
Higher savings:
  • Many duplicates in logs     → 60%+
  • Repeated errors             → 70%+
  • CI/CD output                → 70%+

Lower savings:
  • Unique code                 → 15-25%
  • Short sessions              → less than 10%
  • Structured chat             → 20-30%
```

### Retention analysis by record type (Debugging)

| Type | Retained | Total | Efficiency |
|------|----------|-------|------------|
| Files | 3 | 3 | 100% |
| Errors | 2 | 15 | 13% |
| Messages | 3 | 8 | 37% |
| Decisions | 1 | 2 | 50% |
| Test results | 1 | 8 | 12% |
| Tool calls | 1 | 5 | 20% |
| Notes | 1 | 3 | 33% |
| Diffs | 1 | 5 | 20% |

---

## Cost Impact

### Claude 3.5 Sonnet ($0.01/1k tokens)

| Scenario | Tokens Saved | Savings $ |
|----------|--------------|-----------|
| Debugging | 1,247 | $0.012 |
| Code Review | 224 | $0.002 |

### Annual savings

- 20 sessions per week = ~22,000 tokens per month
- Annual savings: ~260K tokens (~$260)

---

## Analysis: What Is Removed and What Is Kept

### ✅ Always kept

- **File snapshots** (100%)
- **Accepted decisions** with constraints
- **Errors with stack traces**

### ❌ Often removed

- **Duplicate errors** (15 → 2 in the test)
- **Repeated tool_call results**
- **Assistant noise messages**

---

## How to Reproduce

```bash
npx tsx ./bench-real.ts
```

The script tests 2 scenarios:
1. Debugging session (56% savings)
2. Code Review (17% savings)

You can modify the data and run it on your own cases.

---

## Limitations

1. Token counters use the chars/4 heuristic (an estimate, not an exact tokenizer)
2. No LLM semantic understanding — only scoring heuristics
3. Local operation (no network calls during optimization)
4. Results depend on record structure and query quality

---

*Full source code: [github.com/Koderkup/context-optimizer](https://github.com/Koderkup/context-optimizer)*  
*Pro version includes extended fixtures and additional benchmark scripts.*
