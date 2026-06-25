/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IEditorSerializer, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { POLVO_AGENT_CHAT_SCHEME } from './polvoAgentConversationsService.js';

export class PolvoAgentChatEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.polvoAgentChat';
	static readonly EditorID = 'workbench.editor.polvoAgentChat';

	constructor(readonly resource: URI) {
		super();
		if (resource.scheme !== POLVO_AGENT_CHAT_SCHEME) {
			throw new Error(`Invalid polvo agent chat resource: ${resource.toString()}`);
		}
	}

	override get typeId(): string {
		return PolvoAgentChatEditorInput.TypeID;
	}

	override get editorId(): string | undefined {
		return PolvoAgentChatEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return localize('polvoAgentChatEditor', "Agente");
	}

	override getIcon(): ThemeIcon {
		return Codicon.sparkle;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof PolvoAgentChatEditorInput) {
			return other.resource.toString() === this.resource.toString();
		}
		return false;
	}
}

export class PolvoAgentChatEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: EditorInput): string | undefined {
		if (input instanceof PolvoAgentChatEditorInput) {
			return input.resource.toString();
		}
		return undefined;
	}

	deserialize(instantiationService: unknown, serialized: string): EditorInput | undefined {
		return new PolvoAgentChatEditorInput(URI.parse(serialized));
	}
}
