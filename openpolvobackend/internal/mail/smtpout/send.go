package smtpout

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

// SendText envia e-mail em texto simples (UTF-8) usando STARTTLS em portas típicas (587) ou TLS implícito (465).
func SendText(host string, port int, username, password, fromEmail, fromName string, useTLS bool, to []string, subject, body string) error {
	if len(to) == 0 {
		return fmt.Errorf("smtp: destinatário obrigatório")
	}
	fromHeader := fromEmail
	if strings.TrimSpace(fromName) != "" {
		fromHeader = fmt.Sprintf("%s <%s>", mimeEncodeWord(fromName), fromEmail)
	}
	var buf bytes.Buffer
	buf.WriteString("From: " + fromHeader + "\r\n")
	buf.WriteString("To: " + strings.Join(to, ", ") + "\r\n")
	buf.WriteString("Subject: " + mimeEncodeWord(subject) + "\r\n")
	buf.WriteString("MIME-Version: 1.0\r\n")
	buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	buf.WriteString("\r\n")
	buf.WriteString(body)

	addr := fmt.Sprintf("%s:%d", host, port)
	tlsConf := &tls.Config{ServerName: host}
	auth := smtp.PlainAuth("", username, password, host)

	if port == 465 {
		conn, err := tls.Dial("tcp", addr, tlsConf)
		if err != nil {
			return fmt.Errorf("smtp tls dial: %w", err)
		}
		// smtp.Client fecha a ligação no Quit/Close.
		return sendOnConn(conn, host, auth, fromEmail, to, buf.Bytes())
	}

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	defer conn.Close()
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()
	if useTLS {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(tlsConf); err != nil {
				return fmt.Errorf("smtp starttls: %w", err)
			}
		}
	}
	if username != "" {
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(fromEmail); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	for _, rcpt := range to {
		if err := c.Rcpt(strings.TrimSpace(rcpt)); err != nil {
			return fmt.Errorf("smtp rcpt %s: %w", rcpt, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(buf.Bytes()); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func sendOnConn(conn net.Conn, heloHost string, auth smtp.Auth, from string, to []string, msg []byte) error {
	c, err := smtp.NewClient(conn, heloHost)
	if err != nil {
		return err
	}
	defer c.Close()
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, rcpt := range to {
		if err := c.Rcpt(strings.TrimSpace(rcpt)); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func mimeEncodeWord(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	needs := false
	for _, r := range s {
		if r > 127 || r == '"' || r == '\r' || r == '\n' {
			needs = true
			break
		}
	}
	if !needs {
		return s
	}
	return fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(s)))
}
