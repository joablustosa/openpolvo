package domain

import "strings"

type ModelProvider string

const (
	ModelOpenAI ModelProvider = "openai"
	ModelGoogle ModelProvider = "google"
)

func ParseModelProvider(s string) (ModelProvider, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case string(ModelOpenAI):
		return ModelOpenAI, true
	case string(ModelGoogle):
		return ModelGoogle, true
	case "":
		return "", true
	default:
		return "", false
	}
}
