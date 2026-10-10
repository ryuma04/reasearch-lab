package auth

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestEncryptRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	sealed, err := Encrypt(key, "gho_secret")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("gho_secret")) {
		t.Fatal("ciphertext contains plaintext")
	}
	got, err := Decrypt(key, sealed)
	if err != nil || got != "gho_secret" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := Decrypt(bytes.Repeat([]byte{8}, 32), sealed); err == nil {
		t.Fatal("decrypt with wrong key should fail")
	}
}

func TestSession(t *testing.T) {
	secret := []byte("0123456789abcdef")
	tok, err := signSession(secret, 42, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	uid, err := verifySession(secret, tok)
	if err != nil || uid != 42 {
		t.Fatalf("got %d, %v", uid, err)
	}
	if _, err := verifySession([]byte("another-secret-xx"), tok); err == nil {
		t.Fatal("wrong secret accepted")
	}
	payload, sig, _ := strings.Cut(tok, ".")
	if _, err := verifySession(secret, payload+"x."+sig); err == nil {
		t.Fatal("tampered payload accepted")
	}
	expired, _ := signSession(secret, 42, -time.Minute)
	if _, err := verifySession(secret, expired); err == nil {
		t.Fatal("expired token accepted")
	}
}
