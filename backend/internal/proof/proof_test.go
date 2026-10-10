package proof

import "testing"

func TestIsAllowed(t *testing.T) {
	allowed := []float64{81, 74, 0.9812, 146}
	cases := map[string]bool{
		"81":     true,  // exact metric
		"74":     true,  // paper claim
		"0.98":   true,  // rounded metric
		"98.12%": true,  // percentage of 0.9812
		"3":      true,  // small counting number
		"77":     false, // never produced
		"1,234":  false,
	}
	for tok, want := range cases {
		if got := isAllowed(tok, allowed); got != want {
			t.Errorf("isAllowed(%q) = %v, want %v", tok, got, want)
		}
	}
}
