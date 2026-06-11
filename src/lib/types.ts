export type VMStatus = 'creating' | 'running' | 'stopped' | 'error';

export interface VM {
	id: string;
	name: string;
	status: VMStatus;
	ip: string;
	socketPath: string;
	vsockPath: string;
	tapDevice: string;
	provider: string;
	model: string;
	apiKey: string;
	createdAt: string;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: string;
}
