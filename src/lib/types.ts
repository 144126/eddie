export type VMStatus = 'creating' | 'running' | 'stopped' | 'error';

export interface VM {
	i: string;
	n: string;
	s: VMStatus;
	b?: string;
	p: string;
	m: string;
	k: string;
	t: string;
	c: string;
}

export interface Message {
	i: string;
	r: 'user' | 'assistant' | 'tool';
	c: string;
	a: string;
}
