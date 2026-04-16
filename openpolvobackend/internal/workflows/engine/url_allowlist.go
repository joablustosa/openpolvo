package engine

import (
	"net/url"
	"strings"
)

// DefaultAllowedHosts inclui origens dos plugins nativos e localhost para dev.
var DefaultAllowedHosts = []string{
	"web.whatsapp.com",
	"www.instagram.com",
	"www.facebook.com",
	"mail.google.com",
	"preprod-guanabara-backoffice-smartbus.smarttravelit.com",
	"dev-portal.gbtech.guanabaraholding.com.br",
	"www.gbtech.com.br",
	"www.clickbus.com.br",
	"www.buscaonibus.com.br",
	"localhost",
	"127.0.0.1",
}

// HostAllowed verifica se o host do URL está na lista (subdomínios de um host permitido também).
func HostAllowed(rawURL string, extra []string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(strings.Split(u.Host, ":")[0])
	all := append(append([]string{}, DefaultAllowedHosts...), extra...)
	for _, h := range all {
		h = strings.ToLower(strings.TrimSpace(h))
		if h == "" {
			continue
		}
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}
