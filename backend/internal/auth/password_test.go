package auth

import (
	"strings"
	"testing"
)

func TestPasswordHashing(t *testing.T) {
	h, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "pbkdf2-sha256$") || strings.Contains(h, "correct horse") {
		t.Fatalf("unexpected hash format: %s", h)
	}
	if !CheckPassword("correct horse battery", h) {
		t.Error("right password rejected")
	}
	if CheckPassword("wrong password", h) || CheckPassword("correct horse battery", "") || CheckPassword("x", "garbage$1$a$b") {
		t.Error("wrong password or bad hash accepted")
	}
	h2, _ := HashPassword("correct horse battery")
	if h == h2 {
		t.Error("salt is not random")
	}
	if validatePassword("abc12") == nil || validatePassword("long enough") != nil {
		t.Error("password length rule wrong")
	}
}
