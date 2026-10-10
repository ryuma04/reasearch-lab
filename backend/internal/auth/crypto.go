package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Encrypt seals plaintext with AES-256-GCM. Output is nonce || ciphertext.
func Encrypt(key []byte, plaintext string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func Decrypt(key, sealed []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt token: %w", err)
	}
	return string(pt), nil
}

// Session tokens are stateless: base64(json claims) + "." + base64(HMAC-SHA256).
type sessionClaims struct {
	UserID int64 `json:"uid"`
	Exp    int64 `json:"exp"`
}

func signSession(secret []byte, userID int64, ttl time.Duration) (string, error) {
	body, err := json.Marshal(sessionClaims{UserID: userID, Exp: time.Now().Add(ttl).Unix()})
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	return payload + "." + mac(secret, payload), nil
}

func verifySession(secret []byte, token string) (int64, error) {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(mac(secret, payload))) {
		return 0, errors.New("bad session signature")
	}
	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return 0, err
	}
	var c sessionClaims
	if err := json.Unmarshal(body, &c); err != nil {
		return 0, err
	}
	if time.Now().Unix() > c.Exp {
		return 0, errors.New("session expired")
	}
	return c.UserID, nil
}

func mac(secret []byte, payload string) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func RandomToken(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
