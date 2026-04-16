package ports

import "errors"

var (
	ErrNotFound           = errors.New("conversation not found")
	ErrForbidden          = errors.New("forbidden")
	ErrEmptyMessage       = errors.New("empty message")
	ErrEmptyTitle         = errors.New("empty title")
	ErrAgentDisabled      = errors.New("agent not configured: set POLVO_INTELLIGENCE_BASE_URL and POLVO_INTELLIGENCE_INTERNAL_KEY and run Open Polvo Intelligence")
	ErrModelNotConfigured = errors.New("no API key for the selected model provider")
)
