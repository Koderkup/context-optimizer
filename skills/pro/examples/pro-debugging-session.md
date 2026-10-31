# Pro Example: Profiling and CI log analysis

## Goal

Analyze CI logs and test failures to debug a regression in the authentication module.

## Using debug profile

1. Load the `profiles/debug.json` configuration
2. Extract relevant errors from CI logs
3. Build context with error-focused optimization

## Sample workflow

```typescript
// Step 1: Ingest CI errors
await ingest_records({
  records: [
    {
      kind: "error",
      message: "Expected 200 but received 401",
      path: "src/auth/policy.ts",
      errorType: "TestFailure"
    }
  ]
});

// Step 2: Get relevant errors
const errors = await get_relevant_errors({
  query: "authentication 401",
  limit: 10
});

// Step 3: Build optimized context using debug profile settings
const context = await build_context({
  task: "Fix the 401 authentication regression",
  query: "401 authentication policy test failure",
  tokenBudget: 4000,
  records: errors.map(e => e.record)
});
```

## Pro Tips

- Use `scripts/analyze-report.ts` to visualize the optimization report
- Compare results with different profiles (`debug.json`, `review.json`, `refactor.json`)
- Use `references/fixtures/sample-errors.json` as a template for structuring error records
