package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
)

// EncryptAES256GCM devolve nonce || ciphertext+tag (formato interno).
func EncryptAES256GCM(plaintext []byte, key []byte) ([]byte, error) {
	if len(key) != 16 && len(key) != 24 && len(key) != 32 {
		return nil, errors.New("aes key must be 16, 24 or 32 bytes")
	}
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(b)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	out := gcm.Seal(nonce, nonce, plaintext, nil)
	return out, nil
}

func DecryptAES256GCM(blob []byte, key []byte) ([]byte, error) {
	if len(key) != 16 && len(key) != 24 && len(key) != 32 {
		return nil, errors.New("aes key must be 16, 24 or 32 bytes")
	}
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(b)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(blob) < ns {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := blob[:ns], blob[ns:]
	return gcm.Open(nil, nonce, ct, nil)
}
