package application

import (
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

var cronParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

func scheduleLocation(tzName string) *time.Location {
	loc, err := time.LoadLocation(strings.TrimSpace(tzName))
	if err != nil || strings.TrimSpace(tzName) == "" {
		return time.UTC
	}
	return loc
}

// ScheduleNextUTC devolve o próximo tick do cron após o anchor (createdAt ou lastFired),
// retornando o instante em UTC. O cálculo usa o fuso indicado.
func ScheduleNextUTC(expr, tzName string, lastFired *time.Time, createdAt time.Time) (time.Time, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return time.Time{}, nil
	}
	sched, err := cronParser.Parse(expr)
	if err != nil {
		return time.Time{}, err
	}
	loc := scheduleLocation(tzName)
	anchor := createdAt
	if lastFired != nil {
		anchor = *lastFired
	}
	// Evita “deriva” por segundos: trabalhamos alinhados ao minuto.
	anchor = anchor.In(loc).Truncate(time.Minute)
	next := sched.Next(anchor)
	return next.UTC(), nil
}

// ScheduleIsDue devolve true se o instante actual já passou o próximo tick após a última execução (ou criação).
func ScheduleIsDue(expr, tzName string, lastFired *time.Time, createdAt time.Time, now time.Time) (bool, error) {
	nextUTC, err := ScheduleNextUTC(expr, tzName, lastFired, createdAt)
	if err != nil {
		return false, err
	}
	if nextUTC.IsZero() {
		return false, nil
	}
	return !now.UTC().Before(nextUTC), nil
}
