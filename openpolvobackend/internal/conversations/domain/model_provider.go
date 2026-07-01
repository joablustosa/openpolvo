package domain

import "strings"

type ModelProvider string

const (
	ModelOpenAI    ModelProvider = "openai"
	ModelGoogle    ModelProvider = "google"
	ModelAnthropic ModelProvider = "anthropic"
	ModelOllama    ModelProvider = "ollama"
	ModelAuto      ModelProvider = "auto"
)

func ParseModelProvider(s string) (ModelProvider, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case string(ModelOpenAI):
		return ModelOpenAI, true
	case string(ModelGoogle):
		return ModelGoogle, true
	case string(ModelAnthropic):
		return ModelAnthropic, true
	case string(ModelOllama):
		return ModelOllama, true
	case string(ModelAuto):
		return ModelAuto, true
	case "":
		return "", true
	default:
		return "", false
	}
}
