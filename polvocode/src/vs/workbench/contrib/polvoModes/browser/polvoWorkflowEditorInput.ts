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
import { POLVO_WORKFLOW_SCHEME } from './polvoWorkflowsService.js';

export class PolvoWorkflowEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.polvoWorkflow';
	static readonly EditorID = 'workbench.editor.polvoWorkflow';

	constructor(readonly resource: URI) {
		super();
		if (resource.scheme !== POLVO_WORKFLOW_SCHEME) {
			throw new Error(`Invalid polvo workflow resource: ${resource.toString()}`);
		}
	}

	override get typeId(): string {
		return PolvoWorkflowEditorInput.TypeID;
	}

	override get editorId(): string | undefined {
		return PolvoWorkflowEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return localize('polvoWorkflowEditor', "Automações");
	}

	override getIcon(): ThemeIcon {
		return Codicon.runAll;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof PolvoWorkflowEditorInput) {
			return other.resource.toString() === this.resource.toString();
		}
		return false;
	}
}

export class PolvoWorkflowEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: EditorInput): string | undefined {
		if (input instanceof PolvoWorkflowEditorInput) {
			return input.resource.toString();
		}
		return undefined;
	}

	deserialize(_instantiationService: unknown, serialized: string): EditorInput | undefined {
		return new PolvoWorkflowEditorInput(URI.parse(serialized));
	}
}
