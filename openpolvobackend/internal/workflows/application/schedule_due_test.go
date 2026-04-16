package application

import (
	"testing"
	"time"
)

func TestScheduleIsDue_HourlyAfterCreation(t *testing.T) {
	created := time.Date(2026, 4, 15, 8, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 15, 10, 5, 0, 0, time.UTC)
	due, err := ScheduleIsDue("0 * * * *", "UTC", nil, created, now)
	if err != nil {
		t.Fatal(err)
	}
	if !due {
		t.Fatal("expected due")
	}
}

func TestScheduleIsDue_NotYet(t *testing.T) {
	last := time.Date(2026, 4, 15, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 15, 9, 10, 0, 0, time.UTC)
	due, err := ScheduleIsDue("0 10 * * *", "UTC", &last, time.Time{}, now)
	if err != nil {
		t.Fatal(err)
	}
	if due {
		t.Fatal("expected not due")
	}
}
