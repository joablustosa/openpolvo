package application

import (
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

var cronParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

// ScheduleIsDue devolve true se o instante actual já passou o próximo tick após a última execução (ou criação).
func ScheduleIsDue(expr, tzName string, lastFired *time.Time, createdAt time.Time, now time.Time) (bool, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return false, nil
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil || tzName == "" {
		loc = time.UTC
	}
	sched, err := cronParser.Parse(expr)
	if err != nil {
		return false, err
	}
	anchor := createdAt.In(loc)
	if lastFired != nil {
		anchor = lastFired.In(loc)
	}
	next := sched.Next(anchor)
	return !now.In(loc).Before(next), nil
}
