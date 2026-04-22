package metaapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// VerifyWebhookSignature valida o header X-Hub-Signature-256 enviado pela Meta.
func VerifyWebhookSignature(appSecret string, payload []byte, header string) bool {
	if appSecret == "" {
		return false
	}
	sig := strings.TrimPrefix(header, "sha256=")
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sig), []byte(expected))
}

// WhatsAppMessage representa uma mensagem recebida via webhook do WhatsApp.
type WhatsAppMessage struct {
	From    string
	ID      string
	Body    string
	PhoneID string
}

// FacebookMessage representa uma mensagem recebida via Messenger.
type FacebookMessage struct {
	SenderID  string
	PageID    string
	MessageID string
	Text      string
}

// InstagramMessage representa uma mensagem recebida via Instagram DM.
type InstagramMessage struct {
	SenderID    string
	RecipientID string
	MessageID   string
	Text        string
}

// WebhookEvent evento genérico recebido.
type WebhookEvent struct {
	Object    string
	WhatsApp  []WhatsAppMessage
	Facebook  []FacebookMessage
	Instagram []InstagramMessage
}

// ParseWebhookEvent analisa o body JSON de um evento de webhook da Meta.
func ParseWebhookEvent(body []byte) (*WebhookEvent, error) {
	var raw struct {
		Object string `json:"object"`
		Entry  []struct {
			ID      string `json:"id"`
			Changes []struct {
				Field string `json:"field"`
				Value struct {
					// WhatsApp
					Messages []struct {
						From string `json:"from"`
						ID   string `json:"id"`
						Type string `json:"type"`
						Text struct {
							Body string `json:"body"`
						} `json:"text"`
					} `json:"messages"`
					Metadata struct {
						PhoneNumberID string `json:"phone_number_id"`
					} `json:"metadata"`
				} `json:"value"`
			} `json:"changes"`
			// Facebook/Instagram Messaging
			Messaging []struct {
				Sender struct {
					ID string `json:"id"`
				} `json:"sender"`
				Recipient struct {
					ID string `json:"id"`
				} `json:"recipient"`
				Message struct {
					Mid  string `json:"mid"`
					Text string `json:"text"`
				} `json:"message"`
			} `json:"messaging"`
		} `json:"entry"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	ev := &WebhookEvent{Object: raw.Object}
	for _, e := range raw.Entry {
		// WhatsApp events chegam em changes[].value.messages
		for _, ch := range e.Changes {
			for _, m := range ch.Value.Messages {
				if m.Type == "text" {
					ev.WhatsApp = append(ev.WhatsApp, WhatsAppMessage{
						From:    m.From,
						ID:      m.ID,
						Body:    m.Text.Body,
						PhoneID: ch.Value.Metadata.PhoneNumberID,
					})
				}
			}
		}
		// Facebook/Instagram Messaging
		for _, m := range e.Messaging {
			if m.Message.Text == "" {
				continue
			}
			switch raw.Object {
			case "instagram":
				ev.Instagram = append(ev.Instagram, InstagramMessage{
					SenderID:    m.Sender.ID,
					RecipientID: m.Recipient.ID,
					MessageID:   m.Message.Mid,
					Text:        m.Message.Text,
				})
			default: // "page"
				ev.Facebook = append(ev.Facebook, FacebookMessage{
					SenderID:  m.Sender.ID,
					PageID:    e.ID,
					MessageID: m.Message.Mid,
					Text:      m.Message.Text,
				})
			}
		}
	}
	return ev, nil
}
