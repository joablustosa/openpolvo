package schedule

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	financemysql "github.com/open-polvo/open-polvo/internal/finance/adapters/mysql"
	"github.com/open-polvo/open-polvo/internal/finance/domain"
	idmysql "github.com/open-polvo/open-polvo/internal/identity/adapters/mysql"
	idports "github.com/open-polvo/open-polvo/internal/identity/ports"
	mailapp "github.com/open-polvo/open-polvo/internal/mail/application"
	tasklistsmysql "github.com/open-polvo/open-polvo/internal/tasklists/adapters/mysql"
)

// StartFinanceJobs corre lembretes de assinaturas e digest diário por SMTP do utilizador.
// Usa interval (mín. 1 min); o digest só envia na hora local configurada (timezone + digest_hour).
func StartFinanceJobs(ctx context.Context, interval time.Duration, store *financemysql.Store, mail *mailapp.SendUserEmail, users idmysql.UserRepository, tasks *tasklistsmysql.TaskItemRepository, log *slog.Logger) {
	if store == nil || mail == nil || log == nil {
		return
	}
	if interval < time.Minute {
		interval = time.Hour
	}
	t := time.NewTicker(interval)
	go func() {
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				runFinanceJobs(context.Background(), store, mail, users, tasks, log)
			}
		}
	}()
}

func runFinanceJobs(ctx context.Context, store *financemysql.Store, mail *mailapp.SendUserEmail, users idmysql.UserRepository, tasks *tasklistsmysql.TaskItemRepository, log *slog.Logger) {
	remindRows, err := store.ListSubscriptionReminders(ctx, time.Now().UTC())
	if err != nil {
		log.Warn("subscription reminders list", "err", err)
	} else {
		for i := range remindRows {
			row := &remindRows[i]
			to := strings.TrimSpace(row.Email)
			if to == "" {
				continue
			}
			subj := fmt.Sprintf("Open Polvo: %s — já pagaste?", row.Sub.Name)
			body := fmt.Sprintf("Tens uma assinatura com vencimento: %s (%d %s).\nConfirma em Finanças > Assinaturas ou diz-me na conversa.\n", row.Sub.Name, row.Sub.AmountMinor, row.Sub.Currency)
			if err := mail.Execute(ctx, row.Sub.UserID, mailapp.SendUserEmailInput{To: to, Subject: subj, Body: body}); err != nil {
				log.Warn("subscription reminder send", "sub_id", row.Sub.ID, "err", err)
				continue
			}
			if err := store.MarkSubscriptionReminderSent(ctx, row.Sub.ID, row.Sub.UserID, time.Now().UTC()); err != nil {
				log.Warn("subscription reminder mark", "sub_id", row.Sub.ID, "err", err)
			}
		}
	}

	settings, err := store.ListDigestEnabled(ctx)
	if err != nil {
		log.Warn("digest settings list", "err", err)
		return
	}
	for i := range settings {
		processDigest(ctx, &settings[i], store, mail, users, tasks, log)
	}
}

func processDigest(ctx context.Context, st *domain.DigestSettings, store *financemysql.Store, mail *mailapp.SendUserEmail, users idmysql.UserRepository, tasks *tasklistsmysql.TaskItemRepository, log *slog.Logger) {
	loc, err := time.LoadLocation(st.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	if now.Hour() != st.DigestHour {
		return
	}
	todayStr := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).Format("2006-01-02")
	if st.LastDigestSentOn != nil {
		ld := st.LastDigestSentOn.In(loc)
		lastStr := time.Date(ld.Year(), ld.Month(), ld.Day(), 0, 0, 0, 0, loc).Format("2006-01-02")
		if lastStr == todayStr {
			return
		}
	}
	u, err := users.GetByID(ctx, st.UserID)
	if err != nil {
		if errors.Is(err, idports.ErrNotFound) {
			return
		}
		log.Warn("digest user lookup", "user_id", st.UserID, "err", err)
		return
	}
	email := strings.TrimSpace(u.Email)
	if email == "" {
		return
	}
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	taskRangeEnd := dayStart.Add(48 * time.Hour)

	var body strings.Builder
	fmt.Fprintf(&body, "Open Polvo — resumo de %s\n\n", todayStr)
	if st.IncludeTasks && tasks != nil {
		due, err := tasks.ListDueInRangeForUser(ctx, st.UserID, dayStart.UTC(), taskRangeEnd.UTC())
		if err != nil {
			log.Warn("digest tasks", "user_id", st.UserID, "err", err)
		} else if len(due) == 0 {
			body.WriteString("Tarefas com prazo (hoje/amanhã): nenhuma.\n")
		} else {
			body.WriteString("Tarefas com prazo (hoje/amanhã):\n")
			for _, r := range due {
				fmt.Fprintf(&body, "- %s: %s (%s)\n", r.ListTitle, r.Title, r.DueAt.In(loc).Format("2006-01-02 15:04"))
			}
			body.WriteString("\n")
		}
	}
	if st.IncludeFinanceSummary {
		nextDay := dayStart.Add(24 * time.Hour)
		txs, err := store.ListTransactionsByRange(ctx, st.UserID, dayStart.UTC(), nextDay.UTC(), nil)
		if err != nil {
			log.Warn("digest txs", "user_id", st.UserID, "err", err)
		} else {
			body.WriteString("Transacções hoje:\n")
			if len(txs) == 0 {
				body.WriteString("- (nenhuma)\n")
			}
			for i := range txs {
				t := &txs[i]
				fmt.Fprintf(&body, "- %s %s %d %s %s\n", t.OccurredAt.In(loc).Format("15:04"), t.Direction, t.AmountMinor, t.Currency, strings.TrimSpace(t.Description))
			}
			body.WriteString("\n")
		}
		subs, err := store.ListSubscriptionsByUser(ctx, st.UserID)
		if err != nil {
			log.Warn("digest subs", "user_id", st.UserID, "err", err)
		} else {
			var overdue []domain.Subscription
			for i := range subs {
				s := &subs[i]
				if s.Status != domain.SubActive {
					continue
				}
				if s.NextDueAt.Before(dayStart.UTC()) {
					overdue = append(overdue, *s)
				}
			}
			body.WriteString("Assinaturas em atraso (antes de hoje):\n")
			if len(overdue) == 0 {
				body.WriteString("- (nenhuma)\n")
			}
			for i := range overdue {
				s := &overdue[i]
				fmt.Fprintf(&body, "- %s (venc.: %s, %d %s)\n", s.Name, s.NextDueAt.In(loc).Format("2006-01-02"), s.AmountMinor, s.Currency)
			}
		}
	}

	subj := fmt.Sprintf("Open Polvo — resumo diário %s", todayStr)
	if err := mail.Execute(ctx, st.UserID, mailapp.SendUserEmailInput{To: email, Subject: subj, Body: body.String()}); err != nil {
		log.Warn("digest send", "user_id", st.UserID, "err", err)
		return
	}
	dayKey, err := time.Parse("2006-01-02", todayStr)
	if err != nil {
		log.Warn("digest day parse", "err", err)
		return
	}
	if err := store.UpdateDigestLastSentOn(ctx, st.UserID, dayKey); err != nil {
		log.Warn("digest mark sent", "user_id", st.UserID, "err", err)
	}
}
