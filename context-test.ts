// Тестовый скрипт для измерения оптимизации контекста
// Запуск: npx tsx /tmp/context-test.ts

import { ContextOptimizer } from './src/index.js';

// Имитация реальной код-ревью задачи с дубляжами и муслом
const records = [
  {
    kind: "message" as const,
    role: "user" as const,
    text: "Please fix the authentication flow. I think there's a bug in the JWT token handling and also there's a failing test related to expired tokens. The test output is below."
  },
  {
    kind: "error" as const,
    message: "JWT token verification failed: TokenExpiredError",
    path: "src/auth/jwt.ts",
    errorType: "TokenExpiredError"
  },
  {
    kind: "error" as const,
    message: "JWT token verification failed: TokenExpiredError",
    path: "src/auth/jwt.ts",
    errorType: "TokenExpiredError"
  },
  {
    kind: "test_result" as const,
    command: "npm test -- auth",
    failed: 2,
    passed: 1,
    exitCode: 1,
  failures: [
      {
        name: "should handle expired JWT tokens correctly",
        message: "Expected 401 but received 403",
        file: "tests/auth/jwt.test.ts"
      },
      {
        name: "should refresh expired tokens silently",
        message: "TokenExpiredError not caught",
        file: "tests/auth/jwt.test.ts"
      }
    ]
  },
  {
    kind: "tool_call" as const,
    toolName: "grep",
    output: "Found JWT_SECRET in .env file\nJWT_SECRET=supersecretkey123\nWarning: JWT_SECRET not in .env.example"
  },
  {
    kind: "file" as const,
    path: "src/auth/jwt.ts",
    content: `import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default');
    req.user = decoded as any;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.sendStatus(401);
    }
    return res.sendStatus(403);
  }
};`
  },
  {
    kind: "decision" as const,
    text: "Authorization must remain server-side. Do not move JWT verification to client.",
    status: "accepted",
    constraints: ["Security critical - no client-side auth"]
  },
  {
    kind: "note" as const,
    text: "User mentioned they tried restarting the server multiple times (3+ attempts) - likely a config issue"
  },
  {
    kind: "message" as const,
    role: "assistant",
    text: "I'll check the token expiration issue. Let me look at the test output from the auth suite..."
  },
  {
    kind: "tool_call" as const,
    toolName: "read-file",
    output: "tests/auth/jwt.test.ts content:\n\ndescribe('JWT Token Tests', () => {\n  it('should handle expired JWT tokens correctly', async () => {\n    const expiredToken = jwt.sign({id: 1}, process.env.JWT_SECRET || '', { expiresIn: '-1s' });\n    const res = await request(app).post('/login').set('Authorization', `Bearer ${expiredToken}`);\n    expect(res.status).toBe(401);  // Fails: gets 403 instead\n  });\n});"
  },
  // Дубликаты и мусью
  {
    kind: "test_result" as const,
    command: "npm test -- auth",
    failed: 2,
    passed: 1,
    exitCode: 1,
  failures: [
      {
        name: "should handle expired JWT tokens correctly",
        message: "Expected 401 but received 403",
        file: "tests/auth/jwt.test.ts"
      },
      {
        name: "should refresh expired tokens silently",
        message: "TokenExpiredError not caught",
        file: "tests/auth/jwt.test.ts"
      }
    ]
  },
  {
    kind: "error" as const,
    message: "JWT token verification failed: TokenExpiredError",
    path: "src/auth/jwt.ts",
    errorType: "TokenExpiredError"
  },
  {
    kind: "note" as const,
    text: "Also note: user mentioned the same issue 2 weeks ago - check git history for previous fixes"
  }
];

  // Создаём оптимизатор
const optimizer = new ContextOptimizer({
  tokenBudget: 4000,
  weights: {
    errorRelevance: 1.0,
    constraint: 0.9,
    lexicalOverlap: 0.8,
    identifierMatch: 0.7,
    failedAttempt: 0.6,
    recency: 0.5,
    role: 0.4,
    redundancyPenalty: 0.1,
    callerPriority: 0.3
  }
});

// Измеряем исходный размер контекста
const rawSize = JSON.stringify(records).length;
console.log(`\n=== REAL-WORLD BENCHMARK ===`);
console.log(`Input records: ${records.length}`);
console.log(`Raw context size: ${rawSize} characters (~${Math.ceil(rawSize / 4)} tokens)`);

// Оптимизируем
const result = optimizer.buildContextSync({
  task: "Fix JWT token expiration bug in authentication flow",
  query: "JWT TokenExpiredError 401 403 test failure",
  records: records,
  tokenBudget: 4000
});

// Измеряем результат
const optimizedSize = result.context.length;
const tokenEstimate = Math.ceil(optimizedSize / 4);
const reduction = Math.round((1 - tokenEstimate / Math.ceil(rawSize / 4)) * 100);

console.log(`\n=== OPTIMIZATION RESULTS ===`);
console.log(`Optimized context size: ${optimizedSize} characters (~${tokenEstimate} tokens)`);
console.log(`Token reduction: ${reduction}%`);
console.log(`Tokens saved: ${Math.ceil(rawSize / 4) - tokenEstimate}`);
console.log(`\n=== RETAINED SOURCES (${result.sources.length}) ===`);
result.sources.forEach(s => console.log(`- [${s.fragment.kind}] ${s.fragment.provenance.source.label} (${s.selectionReason})`));
console.log(`\n=== OMITTED RECORDS (${result.omitted.length}) ===`);
result.omitted.forEach(o => console.log(`- [${o.kind}] reason: ${o.reason}`));
console.log(`\n=== REPORT ===`);
console.log(result.report);
console.log(`=== END BENCHMARK ===\n`);