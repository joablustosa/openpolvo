package application

import "errors"

var (
	ErrWorkflowNotFound = errors.New("workflow not found")
	ErrLLMNotConfigured = errors.New("LLM not configured for workflow generation")
)
