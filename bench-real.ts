// Реалистичный бенчмарк с 50+ записями
// Запуск: npx tsx ./bench-real.ts

import { ContextOptimizer } from './src/index.js';
import type { InputRecord, FileRecord } from './src/types.js';

// Генерируем тестовые данные имитирующие реальную code review сессию
const records: InputRecord[] = [];

// 5 сообщений пользователя (с дубликатами)
for (let i = 0; i < 5; i++) {
  records.push({
    kind: "message" as const,
    role: "user" as const,
    text: i === 0 ? "Please review the authentication module changes. I've refactored the JWT handling and added refresh token logic. Also there's a bug report about users getting 403 instead of 401 for expired tokens." : "Please look at the auth module changes"
  });
}

// 15 ошибок (много дубликатов)
for (let i = 0; i < 15; i++) {
  records.push({
    kind: "error" as const,
    message: "JWT verification failed: TokenExpiredError" + (i > 4 ? " (repeated)" : ""),
    path: "src/auth/jwt.ts",
    errorType: "TokenExpiredError",
    stack: i < 3 ? `at verifyToken (jwt.ts:45)\n    at authMiddleware (app.ts:22)\n    at next (express.ts:120)` : undefined
  });
}

// 8 результатов тестов (с дубликатами)
for (let i = 0; i < 8; i++) {
  records.push({
    kind: "test_result" as const,
    command: "npm test -- auth --timeout 10000",
    failed: i % 2,
    passed: 9 - (i % 2),
    exitCode: i % 2,
    failures: i % 2 ? [{
      name: "JWT token handling should return 401 for expired tokens",
      message: "Expected 401 but received 403",
      file: "tests/auth/jwt.test.ts"
    }] : []
  });
}

// 5 вызовов инструментов (мусор)
for (let i = 0; i < 5; i++) {
  records.push({
    kind: "tool_call" as const,
    toolName: "grep",
    output: "Found references to JWT_SECRET in .env\nJWT_SECRET=secret123\nWarning: not in .env.example\nJWT_SECRET used in 12 files"
  });
}

// 3 снимка файлов (много повторяющегося кода)
records.push({
  kind: "file" as const,
  path: "src/auth/jwt.ts",
  content: `// JWT utilities
import jwt from 'jsonwebtoken';
export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || '');
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { valid: false, expired: true };
    return { valid: false, expired: false };
  }
};`
});

// Дубликат файла
const lastFile = records[records.length - 1] as FileRecord;
records.push({ ...lastFile, path: "src/auth/jwt-v2.ts" });

records.push({
  kind: "file" as const,
  path: "src/middleware/auth.ts",
  content: `// Auth middleware
import { verifyToken } from '../auth/jwt';
export const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const result = verifyToken(token);
  if (!result.valid) {
    if (result.expired) res.status(401).send('Expired');
    else res.status(403).send('Invalid');
  }
  next();
};`
});

// 2 решения (дубликат)
for (let i = 0; i < 2; i++) {
  records.push({
    kind: "decision" as const,
    text: "Authorization checks must remain server-side. Do not move JWT verification to client.",
    status: "accepted",
    constraints: ["Security critical", "No client-side auth"]
  });
}

// 3 сообщения ассистента (мусор)
for (let i = 0; i < 3; i++) {
  records.push({
    kind: "message" as const,
    role: "assistant",
    text: `I'll analyze the JWT token handling code. Let me check the test failures first... I see there's an issue with how we're handling expired tokens. The current implementation returns 403 instead of 401.`
  });
}

// 5 диффов (много повторений)
for (let i = 0; i < 5; i++) {
  records.push({
    kind: "diff" as const,
    path: "src/auth/jwt.ts",
    diff: `@@ -1,5 +1,5 @@ import jwt from 'jsonwebtoken';
-export const verifyToken = (token: string) => {
+export const verifyToken = (token: string): any => {`
  });
}

// 3 заметки
for (let i = 0; i < 3; i++) {
  records.push({
    kind: "note" as const,
    text: `Note: User reported this issue ${i + 1} days ago. Check previous conversation history.`
  });
}

console.log(`📊 BENCHMARK: Testing with ${records.length} records`);
console.log(`Raw input size: ${JSON.stringify(records).length} chars`);

const optimizer = new ContextOptimizer({
  tokenBudget: 8000,
  weights: {
    lexicalOverlap: 1.0,
    identifierMatch: 0.9,
    errorRelevance: 0.8,
    constraint: 0.7,
    failedAttempt: 0.6,
    recency: 0.5,
    role: 0.4,
    redundancyPenalty: 0.3,
    callerPriority: 0.2
  },
});

const result = optimizer.buildContextSync({
  task: "Review authentication module changes and fix JWT token expiration bug",
  query: "JWT expired token 401 403 authorization",
  records: records,
  tokenBudget: 8000
});

const rawSize = JSON.stringify(records).length;
const optimizedSize = result.context.length;
const rawTokens = Math.ceil(rawSize / 4);
const optTokens = Math.ceil(optimizedSize / 4);
const reduction = Math.round((1 - optTokens / rawTokens) * 100);

console.log(`\n=== BENCHMARK RESULTS ===`);
console.log(`Input records: ${records.length}`);
console.log(`Raw context: ${rawSize} chars (~${rawTokens} tokens)`);
console.log(`Optimized: ${optimizedSize} chars (~${optTokens} tokens)`);
console.log(`Token reduction: ${reduction}%`);
console.log(`Tokens saved: ${rawTokens - optTokens}`);
console.log(`Budget usage: ${result.report.budget.used}/${result.report.budget.requested} (${Math.round(result.report.budget.used / result.report.budget.requested * 100)}%)`);
console.log(`\nSources retained: ${result.sources.length}`);
console.log(`Omissions: ${result.omitted.length}`);

// Подробный анализ
console.log(`\n=== RETENTION BY TYPE ===`);
const typeCounts: Record<string, { total: number; retained: number }> = {};
records.forEach(r => {
  typeCounts[r.kind] = typeCounts[r.kind] || { total: 0, retained: 0 };
  typeCounts[r.kind].total++;
});
result.sources.forEach(s => {
  typeCounts[s.fragment.kind].retained++;
});
Object.entries(typeCounts).forEach(([k, v]) => {
  console.log(`${k}: ${v.retained}/${v.total} retained`);
});
// Второй сценарий: Code Review (меньше дублей, больше уникального контента)
console.log(`\n\n=== SECOND SCENARIO: Code Review ===`);
const reviewRecords: InputRecord[] = [];

// 3 сообщения пользователя
for (let i = 0; i < 3; i++) {
  reviewRecords.push({
    kind: "message" as const,
    role: "user",
    text: i === 0 ? "Please review the authentication middleware changes. We moved JWT verification into a separate file and added refresh token support. Here are the diffs for review." : "Also check the tests pass after the refactor"
  });
}

// 8 ошибок (меньше дубликатов)
for (let i = 0; i < 8; i++) {
  reviewRecords.push({
    kind: "error" as const,
    message: i < 2 ? "Missing return statement after res.status(401)" : `Lint warning: ${i}`,
    path: "src/middleware/auth.ts",
    errorType: "SyntaxError"
  });
}

// 6 результатов тестов
for (let i = 0; i < 6; i++) {
  reviewRecords.push({
    kind: "test_result" as const,
    command: "npm test -- middleware",
    failed: i === 0 ? 1 : 0,
    passed: 9 - (i === 0 ? 1 : 0),
    exitCode: i === 0 ? 1 : 0,
    failures: i === 0 ? [{
      name: "authMiddleware should return 401 for expired tokens",
      message: "Expected 401 but received 403",
      file: "tests/middleware/auth.test.ts"
    }] : []
  });
}

// 3 снимка файлов (разные файлы)
reviewRecords.push({
  kind: "file" as const,
  path: "src/middleware/auth.ts",
  content: `// Auth middleware v2
import { verifyToken } from '../auth/jwt';
export const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({error: 'No token provided'});
  try {
    const result = await verifyToken(token);
    if (!result.valid) {
      if (result.expired) return res.status(401).json({error: 'Token expired'});
      return res.status(403).json({error: 'Invalid token'});
    }
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({error: 'Internal server error'});
  }
};`
});

reviewRecords.push({
  kind: "file" as const,
  path: "src/auth/jwt.ts",
  content: `// JWT utilities v3
import jwt from 'jsonwebtoken';
export const verifyToken = async (token: string) => {
  try {
    const decoded = await jwt.verify(token, process.env.JWT_SECRET || '');
    return { valid: true, user: decoded };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { valid: false, expired: true };
    return { valid: false, expired: false };
  }
};`
});

reviewRecords.push({
  kind: "file" as const,
  path: "tests/middleware/auth.test.ts",
  content: `describe('Auth Middleware', () => {
  it('should return 401 for expired tokens', async () => {
    const expiredToken = jwt.sign({id: 1}, process.env.JWT_SECRET || '', { expiresIn: '-1s' });
    const res = await request(app).get('/api/protected').set('Authorization', 'Bearer ' + expiredToken);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token expired');
  });
  
  it('should call next() for valid tokens', async () => {
    const validToken = jwt.sign({id: 1}, process.env.JWT_SECRET || '');
    const res = await request(app).get('/api/protected').set('Authorization', 'Bearer ' + validToken);
    expect(res.status).toBe(200);
  });
});`
});

// 2 диффа (разные изменения)
reviewRecords.push({
  kind: "diff" as const,
  path: "src/middleware/auth.ts",
  diff: `@@ -1,3 +1,3 @@ import { verifyToken } from '../auth/jwt';
-export const authMiddleware = (req, res, next) => {
+export const authMiddleware = async (req, res, next) => {`
});

reviewRecords.push({
  kind: "diff" as const,
  path: "src/middleware/auth.ts",
  diff: `@@ -10,5 +10,5 @@
-  const result = verifyToken(token);
+  const result = await verifyToken(token);`
});

// 2 решения
for (let i = 0; i < 2; i++) {
  reviewRecords.push({
    kind: "decision" as const,
    text: "Make all middleware functions async for consistency",
    status: "accepted"
  });
}

// 3 сообщения ассистента
for (let i = 0; i < 3; i++) {
  reviewRecords.push({
    kind: "message" as const,
    role: "assistant",
    text: `I'll review these changes. The refactor looks good but I see a few potential issues with error handling and async flow.`
  });
}

// 2 заметки
for (let i = 0; i < 2; i++) {
  reviewRecords.push({
    kind: "note" as const,
    text: `Note: Similar pattern in payment service — consider consistency across modules`
  });
}

const optimizer2 = new ContextOptimizer({
  tokenBudget: 6000,
  weights: {
    lexicalOverlap: 1.0,
    identifierMatch: 0.9,
    errorRelevance: 0.8,
    constraint: 0.7,
    failedAttempt: 0.6,
    recency: 0.5,
    role: 0.4,
    redundancyPenalty: 0.3,
    callerPriority: 0.2
  },
});

const result2 = optimizer2.buildContextSync({
  task: "Review authentication middleware refactoring and check tests after JWT v3",
  query: "auth middleware verifyToken async 401 test failure",
  records: reviewRecords,
  tokenBudget: 6000
});

const rawSize2 = JSON.stringify(reviewRecords).length;
const optimizedSize2 = result2.context.length;
const rawTokens2 = Math.ceil(rawSize2 / 4);
const optTokens2 = Math.ceil(optimizedSize2 / 4);
const reduction2 = Math.round((1 - optTokens2 / rawTokens2) * 100);

console.log(`Input records: ${reviewRecords.length}`);
console.log(`Raw context: ${rawSize2} chars (~${rawTokens2} tokens)`);
console.log(`Optimized: ${optimizedSize2} chars (~${optTokens2} tokens)`);
console.log(`Token reduction: ${reduction2}%`);
console.log(`Tokens saved: ${rawTokens2 - optTokens2}`);
console.log(`Sources retained: ${result2.sources.length}`);
console.log(`Omissions: ${result2.omitted.length}`);

// Итоги по обоим сценариям
console.log(`\n\n=== FINAL SUMMARY ===`);
console.log(`Scenario 1 (Debugging): ${reduction}% reduction (${rawTokens - optTokens} tokens saved)`);
console.log(`Scenario 2 (Code Review): ${reduction2}% reduction (${rawTokens2 - optTokens2} tokens saved)`);
console.log(`Average reduction: ${Math.round((reduction + reduction2) / 2)}%`);
