package domain

import "strings"

// ApplyScheduleFromGraph sincroniza campos de agendamento a partir do primeiro nó `schedule` no grafo.
func ApplyScheduleFromGraph(w *Workflow) {
	var cron *string
	tz := "UTC"
	enabled := false
	for _, n := range w.Graph.Nodes {
		if strings.EqualFold(strings.TrimSpace(n.Type), "schedule") {
			c := strings.TrimSpace(n.Data.Cron)
			if t := strings.TrimSpace(n.Data.Timezone); t != "" {
				tz = t
			}
			enabled = n.Data.ScheduleEnabled
			if c != "" {
				cc := c
				cron = &cc
			}
			break
		}
	}
	if cron == nil || *cron == "" {
		w.ScheduleCron = nil
		w.ScheduleTimezone = tz
		w.ScheduleEnabled = false
		return
	}
	w.ScheduleCron = cron
	w.ScheduleTimezone = tz
	if w.ScheduleTimezone == "" {
		w.ScheduleTimezone = "UTC"
	}
	w.ScheduleEnabled = enabled
}
