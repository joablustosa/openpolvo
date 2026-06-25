/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/openPolvoSignIn.css';
import { $, append, addDisposableListener, EventType, getWindow, hide, show } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { defaultButtonStyles, defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';

export type OpenPolvoSignInMode = 'login' | 'register';

export interface IOpenPolvoCredentials {
	readonly mode: OpenPolvoSignInMode;
	readonly email: string;
	readonly password: string;
	readonly name?: string;
}

export class OpenPolvoSignInPage extends Disposable {

	private readonly overlay: HTMLElement;
	private readonly titleElement: HTMLElement;
	private readonly subtitleElement: HTMLElement;
	private readonly errorElement: HTMLElement;
	private readonly nameField: HTMLElement;
	private readonly emailInput: InputBox;
	private readonly passwordInput: InputBox;
	private readonly nameInput: InputBox;
	private readonly signInButton: Button;
	private readonly toggleModeButton: Button;
	private mode: OpenPolvoSignInMode = 'login';
	private resolveSubmit: ((credentials: IOpenPolvoCredentials | undefined) => void) | undefined;

	constructor(container: HTMLElement) {
		super();

		this.overlay = append(container, $('.openpolvo-signin-page'));
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-modal', 'true');
		this.overlay.tabIndex = -1;
		this._register(toDisposable(() => this.overlay.remove()));

		const card = append(this.overlay, $('.openpolvo-signin-card'));

		const icon = append(card, $('.openpolvo-signin-icon'));
		append(icon, renderIcon(Codicon.agent));

		this.titleElement = append(card, $('h1.openpolvo-signin-title'));
		this.subtitleElement = append(card, $('p.openpolvo-signin-subtitle'));

		const form = append(card, $('.openpolvo-signin-form'));

		this.nameField = append(form, $('.openpolvo-signin-field'));
		append(this.nameField, $('label.openpolvo-signin-label', undefined, localize('openpolvo.name', "Name")));
		this.nameInput = this._register(new InputBox(this.nameField, undefined, {
			placeholder: localize('openpolvo.namePlaceholder', "Your name (optional)"),
			inputBoxStyles: defaultInputBoxStyles,
		}));

		const emailGroup = append(form, $('.openpolvo-signin-field'));
		append(emailGroup, $('label.openpolvo-signin-label', undefined, localize('email', "Email")));
		this.emailInput = this._register(new InputBox(emailGroup, undefined, {
			placeholder: localize('openpolvo.emailPlaceholder', "you@example.com"),
			inputBoxStyles: defaultInputBoxStyles,
		}));

		const passwordGroup = append(form, $('.openpolvo-signin-field'));
		append(passwordGroup, $('label.openpolvo-signin-label', undefined, localize('password', "Password")));
		this.passwordInput = this._register(new InputBox(passwordGroup, undefined, {
			placeholder: localize('openpolvo.passwordPlaceholder', "Your password"),
			type: 'password',
			inputBoxStyles: defaultInputBoxStyles,
		}));

		this.errorElement = append(form, $('.openpolvo-signin-error'));
		this.errorElement.setAttribute('role', 'alert');
		this.errorElement.style.display = 'none';

		const toggleRow = append(card, $('.openpolvo-signin-toggle-row'));
		this.toggleModeButton = this._register(new Button(toggleRow, { ...defaultButtonStyles, secondary: true }));
		this._register(this.toggleModeButton.onDidClick(() => this.setMode(this.mode === 'login' ? 'register' : 'login')));

		const actions = append(card, $('.openpolvo-signin-actions'));

		const backButton = this._register(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		backButton.label = localize('openpolvo.signInBack', "Back");
		this._register(backButton.onDidClick(() => this.cancel()));

		this.signInButton = this._register(new Button(actions, { ...defaultButtonStyles }));
		this._register(this.signInButton.onDidClick(() => this.submit()));

		this._register(this.emailInput.onDidChange(() => this.clearError()));
		this._register(this.passwordInput.onDidChange(() => this.clearError()));
		this._register(this.nameInput.onDidChange(() => this.clearError()));
		this._register(addDisposableListener(this.passwordInput.inputElement, EventType.KEY_DOWN, e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			}
		}));
		this._register(addDisposableListener(getWindow(this.overlay), EventType.KEY_DOWN, e => {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.cancel();
			}
		}, true));

		this.setMode('login');
	}

	setMode(mode: OpenPolvoSignInMode): void {
		this.mode = mode;
		if (mode === 'register') {
			this.titleElement.textContent = localize('openpolvo.registerTitle', "Create OpenPolvo account");
			this.subtitleElement.textContent = localize('openpolvo.registerDetail', "Register to use OpenPolvo across the entire application.");
			this.signInButton.label = localize('openpolvo.createAccount', "Create Account");
			this.toggleModeButton.label = localize('openpolvo.switchToSignIn', "Already have an account? Sign in");
			show(this.nameField);
			this.overlay.setAttribute('aria-label', localize('openpolvo.registerTitle', "Create OpenPolvo account"));
		} else {
			this.titleElement.textContent = localize('openpolvo.signInTitle', "Sign in to OpenPolvo");
			this.subtitleElement.textContent = localize('openpolvo.signInDetail', "Use your OpenPolvo account email and password.");
			this.signInButton.label = localize('signIn', "Sign In");
			this.toggleModeButton.label = localize('openpolvo.switchToRegister', "Create an account");
			hide(this.nameField);
			this.overlay.setAttribute('aria-label', localize('openpolvo.signInTitle', "Sign in to OpenPolvo"));
		}
		this.clearError();
	}

	focus(): void {
		this.overlay.focus();
		this.emailInput.focus();
	}

	waitForSubmit(): Promise<IOpenPolvoCredentials | undefined> {
		this.focus();
		return new Promise<IOpenPolvoCredentials | undefined>(resolve => {
			this.resolveSubmit = resolve;
		});
	}

	setBusy(busy: boolean): void {
		this.signInButton.enabled = !busy;
		this.toggleModeButton.enabled = !busy;
		if (busy) {
			this.emailInput.disable();
			this.passwordInput.disable();
			this.nameInput.disable();
			this.signInButton.label = this.mode === 'register'
				? localize('openpolvo.creatingAccount', "Creating account…")
				: localize('openpolvo.signingIn', "Signing in…");
		} else {
			this.emailInput.enable();
			this.passwordInput.enable();
			this.nameInput.enable();
			this.setMode(this.mode);
		}
	}

	showError(message: string): void {
		this.errorElement.textContent = message;
		this.errorElement.style.display = 'block';
	}

	private clearError(): void {
		this.errorElement.textContent = '';
		this.errorElement.style.display = 'none';
	}

	private submit(): void {
		const email = this.emailInput.value.trim();
		const password = this.passwordInput.value;
		if (!email || !password) {
			this.showError(localize('openpolvo.signInMissingFields', "Enter your email and password."));
			return;
		}
		if (password.length < 8) {
			this.showError(localize('openpolvo.passwordTooShort', "Password must be at least 8 characters."));
			return;
		}
		const resolve = this.resolveSubmit;
		this.resolveSubmit = undefined;
		resolve?.({
			mode: this.mode,
			email,
			password,
			name: this.nameInput.value.trim() || undefined,
		});
	}

	private cancel(): void {
		const resolve = this.resolveSubmit;
		this.resolveSubmit = undefined;
		resolve?.(undefined);
		this.dispose();
	}

	close(): void {
		this.resolveSubmit = undefined;
		this.dispose();
	}
}
