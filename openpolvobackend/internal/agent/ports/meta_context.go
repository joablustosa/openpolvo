package ports

// MetaContext metadados da integração Meta do utilizador (sem tokens) enviados ao orquestrador Intelligence.
type MetaContext struct {
	WhatsAppConfigured  bool   `json:"whatsapp_configured"`
	FacebookConfigured  bool   `json:"facebook_configured"`
	InstagramConfigured bool   `json:"instagram_configured"`
	WAPhoneNumberID     string `json:"wa_phone_number_id,omitempty"`
	FBPageID            string `json:"fb_page_id,omitempty"`
	IGAccountID         string `json:"ig_account_id,omitempty"`
}
