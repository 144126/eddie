import type { Sandbox as CodeSandbox } from '@e2b/code-interpreter';

export type AgentEvent =
	| { t: 'token'; x: string }
	| { t: 'code_exec'; l: string; c: string; o: string }
	| { t: 'done' }
	| { t: 'error'; m: string };

export type LLMMessage =
	| { role: 'system' | 'user' | 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

interface ToolFn {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

const SYSTEM_PROMPT =
	'You are a coding assistant running inside an isolated e2b sandbox. ' +
	'State (variables, files, imports) persists across calls within the same conversation. ' +
	'When the user asks for computation, data work, or code, call the run_code tool. ' +
	'After execution, summarize the result in plain language. ' +
	'Prefer python unless the user specifies another language. ' +
	'Be concise: show the answer, not the process.';

const RUN_CODE_TOOL: ToolFn = {
	name: 'run_code',
	description:
		'Execute code in a persistent sandbox. State (variables, files, imports) persists across calls within the same conversation.',
	parameters: {
		type: 'object',
		properties: {
			language: {
				type: 'string',
				enum: ['python', 'javascript', 'typescript', 'r', 'java', 'bash'],
				description: 'Programming language of the code'
			},
			code: { type: 'string', description: 'Code to execute' }
		},
		required: ['language', 'code']
	}
};

const MAX_STEPS = 5;

function log(step: string, msg: string) {
	console.log(`[AGENT] [${step}] ${msg} (${new Date().toISOString()})`);
}

function apiBaseURL(p: string): string {
	if (p === 'nous') return 'https://inference-api.nousresearch.com/v1';
	if (p === 'openai') return 'https://api.openai.com/v1';
	return 'https://openrouter.ai/api/v1';
}

export function buildApi(p: string, k: string, m: string) {
	return { url: `${apiBaseURL(p)}/chat/completions`, key: k, model: m };
}

async function streamLLM(
	url: string,
	key: string,
	model: string,
	msgs: LLMMessage[],
	emit: (e: AgentEvent) => void
): Promise<{ content: string; toolCalls: ToolCall[] }> {
	log('streamLLM', `POST ${url} model=${model} msgs=${msgs.length}`);
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${key}`,
			'HTTP-Referer': 'https://eddie.local'
		},
		body: JSON.stringify({
			model,
			messages: msgs,
			stream: true,
			tools: [{ type: 'function', function: RUN_CODE_TOOL }],
			tool_choice: 'auto'
		})
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`LLM ${res.status}: ${err.slice(0, 300)}`);
	}
	if (!res.body) throw new Error('LLM: no response body');

	const reader = res.body.getReader();
	const dec = new TextDecoder();
	let buf = '';
	let content = '';
	const toolCalls: Record<number, ToolCall> = {};
	let finishReason: string | null = null;

	const flushLine = (line: string) => {
		if (!line.startsWith('data:')) return;
		const data = line.slice(5).trim();
		if (data === '[DONE]') return;
		try {
			const j = JSON.parse(data);
			const choice = j.choices?.[0];
			if (!choice) return;
			if (choice.finish_reason) finishReason = choice.finish_reason;
			const delta = choice.delta;
			if (delta?.content) {
				content += delta.content;
				emit({ t: 'token', x: delta.content });
			}
			if (delta?.tool_calls) {
				for (const tc of delta.tool_calls) {
					const idx = tc.index ?? 0;
					if (!toolCalls[idx]) {
						toolCalls[idx] = {
							id: tc.id || '',
							type: 'function',
							function: { name: '', arguments: '' }
						};
					}
					if (tc.id) toolCalls[idx].id = tc.id;
					if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
					if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
				}
			}
		} catch {
			// skip malformed SSE chunks
		}
	};

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		const lines = buf.split('\n');
		buf = lines.pop() || '';
		for (const line of lines) flushLine(line);
	}
	if (buf.trim()) flushLine(buf);

	const ordered = Object.keys(toolCalls)
		.sort((a, b) => Number(a) - Number(b))
		.map((k) => toolCalls[Number(k)]!);
	log(
		'streamLLM',
		`done content_len=${content.length} toolCalls=${ordered.length} finish=${finishReason}`
	);
	return { content, toolCalls: ordered };
}

async function runCodeInSandbox(
	sb: CodeSandbox,
	language: string,
	code: string,
	emit: (e: AgentEvent) => void
): Promise<string> {
	log('runCodeInSandbox', `lang=${language} code_len=${code.length}`);
	const stdout: string[] = [];
	const stderr: string[] = [];
	const results: string[] = [];
	let errStr = '';
	try {
		const exec = await sb.runCode(code, {
			language: language as 'python' | 'javascript' | 'typescript' | 'r' | 'java' | 'bash',
			onStdout: (m) => {
				stdout.push(m.line);
			},
			onStderr: (m) => {
				stderr.push(m.line);
			},
			onResult: (r) => {
				if (r.text) results.push(r.text);
			},
			onError: (e) => {
				errStr = `${e.name}: ${e.value}\n${e.traceback}`;
			}
		});
		if (exec.error) errStr = `${exec.error.name}: ${exec.error.value}\n${exec.error.traceback}`;
	} catch (e) {
		errStr = e instanceof Error ? e.message : String(e);
	}
	const parts: string[] = [];
	if (stdout.length) parts.push(stdout.join('\n'));
	if (results.length) parts.push(`[result]\n${results.join('\n')}`);
	if (stderr.length) parts.push(`[stderr]\n${stderr.join('\n')}`);
	if (errStr) parts.push(`[error]\n${errStr}`);
	const out = parts.join('\n').trim() || '(no output)';
	log('runCodeInSandbox', `out_len=${out.length}`);
	emit({ t: 'code_exec', l: language, c: code, o: out });
	return out;
}

export async function chat(opts: {
	msgs: LLMMessage[];
	p: string;
	m: string;
	k: string;
	sb: CodeSandbox;
	emit: (e: AgentEvent) => void;
}): Promise<string> {
	const { msgs, p, m, k, sb, emit } = opts;
	const { url, key, model } = buildApi(p, k, m);
	const history: LLMMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...msgs];
	let lastContent = '';

	for (let step = 0; step < MAX_STEPS; step++) {
		const { content, toolCalls } = await streamLLM(url, key, model, history, emit);
		lastContent = content || lastContent;
		if (toolCalls.length === 0) break;

		history.push({
			role: 'assistant',
			content: content || null,
			tool_calls: toolCalls
		});
		for (const tc of toolCalls) {
			let args: { language?: string; code?: string } = {};
			try {
				args = JSON.parse(tc.function.arguments);
			} catch {
				// keep empty args
			}
			const language = args.language || 'python';
			const code = args.code || '';
			if (!code) {
				const out = 'Error: empty code argument';
				emit({ t: 'code_exec', l: language, c: code, o: out });
				history.push({ role: 'tool', tool_call_id: tc.id, content: out });
				continue;
			}
			const out = await runCodeInSandbox(sb, language, code, emit);
			history.push({ role: 'tool', tool_call_id: tc.id, content: out });
		}
	}

	emit({ t: 'done' });
	return lastContent;
}
