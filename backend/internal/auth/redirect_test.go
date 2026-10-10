package auth

import "testing"

func TestSafeReturnPath(t *testing.T) {
	cases := map[string]string{
		"/workspaces/7":          "/workspaces/7",
		"/dashboard?x=1":         "/dashboard?x=1",
		"":                       "/dashboard",
		"https://evil.example":   "/dashboard",
		"//evil.example/x":       "/dashboard",
		"/\\evil.example":        "/dashboard",
		"workspaces":             "/dashboard",
		"/ok\r\nSet-Cookie: a=b": "/dashboard",
	}
	for in, want := range cases {
		if got := SafeReturnPath(in); got != want {
			t.Errorf("SafeReturnPath(%q) = %q, want %q", in, got, want)
		}
	}
}
