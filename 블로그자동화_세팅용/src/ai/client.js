import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const MODEL = 'claude-opus-4-8';

export const SETUP_TOKEN_HINT =
  '구독 인증을 찾지 못했습니다. 터미널에서 `claude setup-token` 을 실행하고, ' +
  '출력된 토큰을 .env 의 CLAUDE_CODE_OAUTH_TOKEN= 뒤에 붙여넣으세요.';

/**
 * 구독 요금제로만 호출하도록 환경을 정리한다.
 * ANTHROPIC_API_KEY 가 함께 있으면 SDK 가 API 키를 우선해 별도 과금되므로 제거한다.
 *
 * 인증은 두 경로 모두 동작한다:
 *   1) .env 의 CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token` 으로 발급)
 *   2) 이 컴퓨터의 `claude` CLI 로그인 (~/.claude) — 토큰이 없으면 자동으로 여기에 기댄다
 */
export function ensureSubscriptionAuth() {
  if (process.env.ANTHROPIC_API_KEY) {
    delete process.env.ANTHROPIC_API_KEY;
    console.warn('[ai] ANTHROPIC_API_KEY 를 무시합니다 (구독 요금제로 호출).');
  }
}

async function runQuery(prompt, options) {
  const stream = query({ prompt, options });
  for await (const message of stream) {
    // result 가 오면 즉시 끊는다. 계속 읽으면 SDK 하위 프로세스가 정리되는 과정에서
    // 던지는 예외가 올라와, 이미 성공한 응답까지 실패로 만든다.
    if (message.type === 'result') {
      await stream.return?.().catch(() => {});
      return message;
    }
  }
  throw new Error('AI 응답을 받지 못했습니다.');
}

/**
 * 스키마에 맞는 JSON 을 받아온다.
 * @param {string} prompt
 * @param {import('zod').ZodType} schema
 * @param {{systemPrompt?: string, maxTurns?: number}} opts
 */
export async function askJson(prompt, schema, { systemPrompt, maxTurns = 6 } = {}) {
  ensureSubscriptionAuth();

  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' });
  const options = {
    model: MODEL,
    maxTurns,
    // allowedTools 를 비우면 구조화 출력용 StructuredOutput 도구까지 막혀 실패한다.
    // 대신 파일/실행/웹 도구는 blacklist 로 막는다 — 프롬프트에 필요한 내용을 이미 다
    // 넣어주므로 이 도구들이 필요할 일이 없고, headless(launchd) 환경에선 도구 사용 시
    // 승인 요청이 뜰 사람이 없어 그냥 멈춰버려 turn 만 소진하다 error_max_turns 로 죽는다.
    disallowedTools: ['Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    ...(systemPrompt ? { systemPrompt } : {}),
    outputFormat: { type: 'json_schema', schema: jsonSchema },
  };

  // 스키마 재시도가 소진되는 경우가 드물게 있어 한 번 더 기회를 준다.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await runQuery(prompt, options);

    if (result.subtype === 'success' && result.structured_output) {
      const parsed = schema.safeParse(result.structured_output);
      if (parsed.success) return parsed.data;
      if (attempt === 2) {
        throw new Error(`AI 응답이 형식에 맞지 않습니다: ${parsed.error.message}`);
      }
      continue;
    }

    if (attempt === 2) {
      throw new Error(describeFailure(result));
    }
  }
}

function describeFailure(result) {
  const subtype = result?.subtype ?? 'unknown';
  if (subtype === 'error_max_structured_output_retries') {
    return 'AI 가 요구한 형식의 JSON 을 만들지 못했습니다. 수집 자료를 줄이고 다시 시도해 보세요.';
  }
  const detail = typeof result?.result === 'string' ? ` — ${result.result}` : '';
  if (/auth|credential|token|401|unauthor/i.test(detail)) {
    return `${SETUP_TOKEN_HINT}${detail}`;
  }
  return `AI 호출 실패 (${subtype})${detail}`;
}

/** 일반 텍스트 응답이 필요할 때. */
export async function askText(prompt, { systemPrompt, maxTurns = 1 } = {}) {
  ensureSubscriptionAuth();
  const result = await runQuery(prompt, {
    model: MODEL,
    maxTurns,
    disallowedTools: ['Bash', 'Write', 'Edit'],
    ...(systemPrompt ? { systemPrompt } : {}),
  });
  if (result.subtype !== 'success') throw new Error(describeFailure(result));
  return result.result;
}
