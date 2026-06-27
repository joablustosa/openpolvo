/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';

const $ = dom.$;

export interface IRichChatBlock {
	readonly type: string;
	readonly text?: string;
	readonly level?: number;
	readonly title?: string;
	readonly items?: string[];
	readonly variant?: string;
	readonly headers?: string[];
	readonly rows?: string[][];
}

export function extractRichBlocks(metadata: Record<string, unknown> | undefined): IRichChatBlock[] {
	if (!metadata) {
		return [];
	}
	const raw = metadata.rich_blocks;
	if (!Array.isArray(raw)) {
		return [];
	}
	const blocks: IRichChatBlock[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const rec = item as Record<string, unknown>;
		const type = String(rec.type ?? '').trim();
		if (!type) {
			continue;
		}
		blocks.push({
			type,
			text: typeof rec.text === 'string' ? rec.text : undefined,
			level: typeof rec.level === 'number' ? rec.level : undefined,
			title: typeof rec.title === 'string' ? rec.title : undefined,
			items: Array.isArray(rec.items) ? rec.items.map(String) : undefined,
			variant: typeof rec.variant === 'string' ? rec.variant : undefined,
			headers: Array.isArray(rec.headers) ? rec.headers.map(String) : undefined,
			rows: Array.isArray(rec.rows)
				? rec.rows.filter(Array.isArray).map(row => row.map(String))
				: undefined,
		});
	}
	return blocks;
}

export function renderRichChatBlocks(parent: HTMLElement, blocks: IRichChatBlock[]): void {
	dom.clearNode(parent);
	const root = dom.append(parent, $('.polvo-rich-chat'));
	for (const block of blocks) {
		switch (block.type) {
			case 'lead':
				if (block.text) {
					const el = dom.append(root, $('.polvo-rich-lead'));
					el.textContent = block.text;
				}
				break;
			case 'heading': {
				const el = dom.append(root, $('.polvo-rich-heading'));
				if ((block.level ?? 2) === 3) {
					el.classList.add('level-3');
				}
				el.textContent = block.text ?? '';
				break;
			}
			case 'paragraph':
				if (block.text) {
					const el = dom.append(root, $('.polvo-rich-paragraph'));
					el.textContent = block.text;
				}
				break;
			case 'bullet_list':
			case 'key_points': {
				const wrap = dom.append(root, $('.polvo-rich-list-wrap'));
				if (block.title) {
					const title = dom.append(wrap, $('.polvo-rich-list-title'));
					title.textContent = block.title;
				}
				const ul = dom.append(wrap, $('ul.polvo-rich-bullet-list'));
				for (const item of block.items ?? []) {
					const li = document.createElement('li');
					li.textContent = item;
					ul.appendChild(li);
				}
				break;
			}
			case 'numbered_list': {
				const ol = dom.append(root, $('ol.polvo-rich-numbered-list'));
				for (const item of block.items ?? []) {
					const li = document.createElement('li');
					li.textContent = item;
					ol.appendChild(li);
				}
				break;
			}
			case 'callout': {
				const el = dom.append(root, $('.polvo-rich-callout'));
				const variant = (block.variant ?? 'note').toLowerCase();
				el.classList.add(`variant-${variant}`);
				if (block.title) {
					const title = dom.append(el, $('.polvo-rich-callout-title'));
					title.textContent = block.title;
				}
				if (block.text) {
					const body = dom.append(el, $('.polvo-rich-callout-body'));
					body.textContent = block.text;
				}
				break;
			}
			case 'table': {
				const table = dom.append(root, $('table.polvo-rich-table'));
				if (block.headers?.length) {
					const thead = document.createElement('thead');
					const tr = document.createElement('tr');
					for (const h of block.headers) {
						const th = document.createElement('th');
						th.textContent = h;
						tr.appendChild(th);
					}
					thead.appendChild(tr);
					table.appendChild(thead);
				}
				const tbody = document.createElement('tbody');
				for (const row of block.rows ?? []) {
					const tr = document.createElement('tr');
					for (const cell of row) {
						const td = document.createElement('td');
						td.textContent = cell;
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
				}
				table.appendChild(tbody);
				break;
			}
			case 'divider':
				dom.append(root, $('.polvo-rich-divider'));
				break;
			default:
				break;
		}
	}
}

function stripInlineMd(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/__(.+?)__/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Fallback cliente: converte markdown simples em blocos quando metadata não veio do backend. */
export function markdownToRichBlocks(text: string): IRichChatBlock[] {
	const raw = (text ?? '').trim();
	if (!raw) {
		return [];
	}
	const lines = raw.split('\n');
	const blocks: IRichChatBlock[] = [];
	let i = 0;
	let leadSet = false;
	while (i < lines.length) {
		const stripped = lines[i].trim();
		if (!stripped) {
			i++;
			continue;
		}
		if (stripped.startsWith('### ')) {
			blocks.push({ type: 'heading', level: 3, text: stripInlineMd(stripped.slice(4)) });
			i++;
			continue;
		}
		if (stripped.startsWith('## ')) {
			blocks.push({ type: 'heading', level: 2, text: stripInlineMd(stripped.slice(3)) });
			i++;
			continue;
		}
		if (stripped.startsWith('# ')) {
			const title = stripInlineMd(stripped.slice(2));
			if (!leadSet) {
				blocks.push({ type: 'lead', text: title });
				leadSet = true;
			} else {
				blocks.push({ type: 'heading', level: 2, text: title });
			}
			i++;
			continue;
		}
		if (stripped.startsWith('>')) {
			const quote: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith('>')) {
				quote.push(lines[i].trim().replace(/^>\s?/, ''));
				i++;
			}
			blocks.push({ type: 'callout', variant: 'note', text: stripInlineMd(quote.join(' ')) });
			continue;
		}
		const bulletMatch = stripped.match(/^[-*+]\s+(.*)$/);
		if (bulletMatch) {
			const items: string[] = [];
			while (i < lines.length) {
				const m = lines[i].trim().match(/^[-*+]\s+(.*)$/);
				if (!m) {
					break;
				}
				items.push(stripInlineMd(m[1]));
				i++;
			}
			if (items.length) {
				blocks.push({ type: 'bullet_list', items });
			}
			continue;
		}
		const numMatch = stripped.match(/^\d+\.\s+(.*)$/);
		if (numMatch) {
			const items: string[] = [];
			while (i < lines.length) {
				const m = lines[i].trim().match(/^\d+\.\s+(.*)$/);
				if (!m) {
					break;
				}
				items.push(stripInlineMd(m[1]));
				i++;
			}
			if (items.length) {
				blocks.push({ type: 'numbered_list', items });
			}
			continue;
		}
		if (stripped === '---' || stripped === '***') {
			blocks.push({ type: 'divider' });
			i++;
			continue;
		}
		const para: string[] = [stripped];
		i++;
		while (i < lines.length) {
			const nxt = lines[i].trim();
			if (!nxt || nxt.startsWith('#') || nxt.startsWith('>') || /^[-*+]\s+/.test(nxt) || /^\d+\.\s+/.test(nxt)) {
				break;
			}
			para.push(nxt);
			i++;
		}
		const p = stripInlineMd(para.join(' '));
		if (p) {
			if (!leadSet && blocks.length === 0) {
				blocks.push({ type: 'lead', text: p });
				leadSet = true;
			} else {
				blocks.push({ type: 'paragraph', text: p });
			}
		}
	}
	return blocks;
}
