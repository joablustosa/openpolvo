/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import type { IOpenPolvoWorkflowGraph, IOpenPolvoWorkflowNode } from './openPolvoWorkbenchApiService.js';

const $ = dom.$;
const SVG_NS = 'http://www.w3.org/2000/svg';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 84;
const FALLBACK_GRID_X = 280;
const FALLBACK_GRID_Y = 150;
const FALLBACK_PER_ROW = 4;
const CANVAS_PADDING = 60;

interface INodeVisual {
	readonly icon: ThemeIcon;
	readonly accent: string;
}

const NODE_VISUALS: Record<string, INodeVisual> = {
	schedule: { icon: Codicon.watch, accent: 'var(--vscode-charts-purple)' },
	goto: { icon: Codicon.globe, accent: 'var(--vscode-charts-blue)' },
	click: { icon: Codicon.target, accent: 'var(--vscode-charts-blue)' },
	fill: { icon: Codicon.edit, accent: 'var(--vscode-charts-blue)' },
	wait: { icon: Codicon.clock, accent: 'var(--vscode-charts-yellow)' },
	llm: { icon: Codicon.sparkle, accent: 'var(--vscode-charts-green)' },
	web_search: { icon: Codicon.search, accent: 'var(--vscode-charts-orange)' },
	send_email: { icon: Codicon.mail, accent: 'var(--vscode-charts-red)' },
	post_facebook: { icon: Codicon.send, accent: 'var(--vscode-charts-blue)' },
	post_instagram: { icon: Codicon.send, accent: 'var(--vscode-charts-purple)' },
	post_whatsapp: { icon: Codicon.commentDiscussion, accent: 'var(--vscode-charts-green)' },
	post_linkedin: { icon: Codicon.send, accent: 'var(--vscode-charts-blue)' },
	post_x: { icon: Codicon.send, accent: 'var(--vscode-foreground)' },
	post_twitter: { icon: Codicon.send, accent: 'var(--vscode-charts-blue)' },
	post_youtube: { icon: Codicon.deviceCameraVideo, accent: 'var(--vscode-charts-red)' },
};

const DEFAULT_VISUAL: INodeVisual = { icon: Codicon.circleFilled, accent: 'var(--vscode-charts-blue)' };

function nodePosition(node: IOpenPolvoWorkflowNode, index: number): { x: number; y: number } {
	const x = typeof node.position?.x === 'number' ? node.position.x : (index % FALLBACK_PER_ROW) * FALLBACK_GRID_X;
	const y = typeof node.position?.y === 'number' ? node.position.y : Math.floor(index / FALLBACK_PER_ROW) * FALLBACK_GRID_Y;
	return { x, y };
}

/** Canvas visual estilo n8n, renderizado com DOM + SVG (sem React). */
export class PolvoWorkflowCanvas extends Disposable {
	private readonly viewport: HTMLElement;
	private readonly content: HTMLElement;
	private readonly edgeLayer: SVGSVGElement;
	private readonly nodeLayer: HTMLElement;
	private readonly emptyState: HTMLElement;

	private graph: IOpenPolvoWorkflowGraph | undefined;
	private selectedNodeId: string | undefined;
	private readonly nodeElements = new Map<string, HTMLElement>();
	private readonly renderDisposables = this._register(new DisposableStore());

	private panX = CANVAS_PADDING;
	private panY = CANVAS_PADDING;
	private scale = 1;
	private isPanning = false;
	private panStart = { x: 0, y: 0, panX: 0, panY: 0 };

	private readonly _onDidSelectNode = this._register(new Emitter<string | undefined>());
	readonly onDidSelectNode: Event<string | undefined> = this._onDidSelectNode.event;

	constructor(parent: HTMLElement) {
		super();
		this.viewport = dom.append(parent, $('.polvo-workflow-canvas'));
		this.content = dom.append(this.viewport, $('.polvo-workflow-canvas-content'));
		this.edgeLayer = document.createElementNS(SVG_NS, 'svg');
		this.edgeLayer.classList.add('polvo-workflow-edges');
		this.content.appendChild(this.edgeLayer);
		this.nodeLayer = dom.append(this.content, $('.polvo-workflow-nodes'));
		this.emptyState = dom.append(this.viewport, $('.polvo-workflow-canvas-empty'));
		this.emptyState.appendChild(renderIcon(Codicon.typeHierarchySub));
		dom.append(this.emptyState, $('p')).textContent = localize(
			'polvoWorkflowCanvasEmpty',
			"Descreva a automação no chat para desenhar o fluxo aqui.",
		);

		this.registerInteractions();
		this.applyTransform();
	}

	private registerInteractions(): void {
		this._register(dom.addDisposableListener(this.viewport, dom.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.target !== this.viewport && e.target !== this.content && e.target !== this.edgeLayer) {
				return;
			}
			this.selectNode(undefined);
			this.isPanning = true;
			this.panStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
			this.viewport.classList.add('panning');
		}));
		this._register(dom.addDisposableListener(this.viewport, dom.EventType.MOUSE_MOVE, (e: MouseEvent) => {
			if (!this.isPanning) {
				return;
			}
			this.panX = this.panStart.panX + (e.clientX - this.panStart.x);
			this.panY = this.panStart.panY + (e.clientY - this.panStart.y);
			this.applyTransform();
		}));
		const stopPan = () => {
			this.isPanning = false;
			this.viewport.classList.remove('panning');
		};
		this._register(dom.addDisposableListener(this.viewport, dom.EventType.MOUSE_UP, stopPan));
		this._register(dom.addDisposableListener(this.viewport, dom.EventType.MOUSE_LEAVE, stopPan));
		this._register(dom.addDisposableListener(this.viewport, dom.EventType.WHEEL, (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) {
				return;
			}
			e.preventDefault();
			const delta = e.deltaY > 0 ? -0.1 : 0.1;
			this.scale = Math.min(1.6, Math.max(0.4, this.scale + delta));
			this.applyTransform();
		}, { passive: false }));
	}

	private applyTransform(): void {
		this.content.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
	}

	setGraph(graph: IOpenPolvoWorkflowGraph | undefined): void {
		this.graph = graph;
		this.render();
	}

	setSelectedNode(nodeId: string | undefined): void {
		if (this.selectedNodeId === nodeId) {
			return;
		}
		this.selectedNodeId = nodeId;
		this.updateSelectionClasses();
	}

	private selectNode(nodeId: string | undefined): void {
		if (this.selectedNodeId === nodeId) {
			return;
		}
		this.selectedNodeId = nodeId;
		this.updateSelectionClasses();
		this._onDidSelectNode.fire(nodeId);
	}

	private updateSelectionClasses(): void {
		for (const [id, el] of this.nodeElements) {
			el.classList.toggle('selected', id === this.selectedNodeId);
		}
	}

	private render(): void {
		this.renderDisposables.clear();
		this.nodeElements.clear();
		dom.clearNode(this.nodeLayer);
		while (this.edgeLayer.firstChild) {
			this.edgeLayer.removeChild(this.edgeLayer.firstChild);
		}

		const nodes = this.graph?.nodes ?? [];
		const edges = this.graph?.edges ?? [];
		this.emptyState.style.display = nodes.length === 0 ? 'flex' : 'none';
		if (nodes.length === 0) {
			return;
		}

		const positions = new Map<string, { x: number; y: number }>();
		let maxX = 0;
		let maxY = 0;
		nodes.forEach((node, index) => {
			const pos = nodePosition(node, index);
			positions.set(node.id, pos);
			maxX = Math.max(maxX, pos.x + NODE_WIDTH);
			maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
		});

		this.edgeLayer.setAttribute('width', `${maxX + CANVAS_PADDING}`);
		this.edgeLayer.setAttribute('height', `${maxY + CANVAS_PADDING}`);

		for (const edge of edges) {
			const from = positions.get(edge.source);
			const to = positions.get(edge.target);
			if (!from || !to) {
				continue;
			}
			this.renderEdge(from, to);
		}

		nodes.forEach((node, index) => {
			const pos = positions.get(node.id)!;
			this.renderNode(node, pos, index);
		});

		this.updateSelectionClasses();
	}

	private renderEdge(from: { x: number; y: number }, to: { x: number; y: number }): void {
		const x1 = from.x + NODE_WIDTH;
		const y1 = from.y + NODE_HEIGHT / 2;
		const x2 = to.x;
		const y2 = to.y + NODE_HEIGHT / 2;
		const dx = Math.max(40, Math.abs(x2 - x1) / 2);
		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
		path.setAttribute('class', 'polvo-workflow-edge');
		this.edgeLayer.appendChild(path);
	}

	private renderNode(node: IOpenPolvoWorkflowNode, pos: { x: number; y: number }, index: number): void {
		const visual = NODE_VISUALS[node.type] ?? DEFAULT_VISUAL;
		const el = $('.polvo-workflow-node');
		el.style.left = `${pos.x}px`;
		el.style.top = `${pos.y}px`;
		el.style.setProperty('--polvo-node-accent', visual.accent);

		const header = dom.append(el, $('.polvo-workflow-node-header'));
		const iconWrap = dom.append(header, $('.polvo-workflow-node-icon'));
		iconWrap.appendChild(renderIcon(visual.icon));
		const titleWrap = dom.append(header, $('.polvo-workflow-node-titles'));
		const label = typeof node.data?.label === 'string' && node.data.label.trim() ? node.data.label.trim() : node.type;
		dom.append(titleWrap, $('.polvo-workflow-node-label')).textContent = `${index + 1}. ${label}`;
		dom.append(titleWrap, $('.polvo-workflow-node-type')).textContent = node.type;

		const promptText = this.nodePromptPreview(node);
		if (promptText) {
			dom.append(el, $('.polvo-workflow-node-prompt')).textContent = promptText;
		}

		this.renderDisposables.add(dom.addDisposableListener(el, dom.EventType.MOUSE_DOWN, e => e.stopPropagation()));
		this.renderDisposables.add(dom.addDisposableListener(el, dom.EventType.CLICK, e => {
			e.stopPropagation();
			this.selectNode(node.id);
		}));

		this.nodeLayer.appendChild(el);
		this.nodeElements.set(node.id, el);
	}

	private nodePromptPreview(node: IOpenPolvoWorkflowNode): string {
		const data = node.data ?? {};
		const raw = data.prompt ?? data.query ?? data.url ?? data.email_subject ?? data.caption;
		if (typeof raw !== 'string') {
			return '';
		}
		const trimmed = raw.trim();
		return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
	}
}
