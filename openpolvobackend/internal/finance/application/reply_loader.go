package application

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	financeports "github.com/open-polvo/open-polvo/internal/finance/ports"
)

// FinanceReplyLoader monta contexto de finanças para o Intelligence (truncado).
type FinanceReplyLoader struct {
	Categories    financeports.CategoryRepository
	Transactions financeports.TransactionRepository
	Subscriptions financeports.SubscriptionRepository
	MaxRecentTx   int
}

func (l *FinanceReplyLoader) ForReply(ctx context.Context, userID uuid.UUID) *agentports.FinanceContext {
	if l == nil || l.Categories == nil || l.Transactions == nil || l.Subscriptions == nil {
		return nil
	}
	maxR := l.MaxRecentTx
	if maxR <= 0 {
		maxR = 25
	}
	cats, err := l.Categories.ListCategoriesByUser(ctx, userID)
	if err != nil || len(cats) == 0 {
		cats = nil
	}
	txs, err := l.Transactions.ListRecentTransactions(ctx, userID, maxR)
	if err != nil {
		txs = nil
	}
	subs, err := l.Subscriptions.ListSubscriptionsByUser(ctx, userID)
	if err != nil {
		subs = nil
	}
	catName := map[uuid.UUID]string{}
	for i := range cats {
		catName[cats[i].ID] = cats[i].Name
	}
	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	monthEnd := monthStart.AddDate(0, 1, 0)
	totals, _ := l.Transactions.SumByCategoryMonth(ctx, userID, monthStart, monthEnd)

	out := &agentports.FinanceContext{}
	for i := range cats {
		pid := (*string)(nil)
		if cats[i].ParentID != nil {
			s := cats[i].ParentID.String()
			pid = &s
		}
		out.Categories = append(out.Categories, agentports.FinanceCategoryBrief{
			ID: cats[i].ID.String(), ParentID: pid, Name: cats[i].Name,
		})
	}
	for i := range txs {
		t := &txs[i]
		b := agentports.FinanceTransactionBrief{
			ID: t.ID.String(), AmountMinor: t.AmountMinor, Currency: t.Currency,
			Direction: string(t.Direction), Description: clip(t.Description, 200),
			OccurredAt: t.OccurredAt.UTC().Format(time.RFC3339),
		}
		if t.CategoryID != nil {
			if n, ok := catName[*t.CategoryID]; ok {
				b.Category = n
			}
		}
		if t.SubcategoryID != nil {
			if n, ok := catName[*t.SubcategoryID]; ok {
				b.Subcategory = n
			}
		}
		out.RecentTransactions = append(out.RecentTransactions, b)
	}
	for i := range totals {
		out.CategoryTotals = append(out.CategoryTotals, agentports.FinanceCategoryTotal{
			Category: totals[i].CategoryName,
			Direction: string(totals[i].Direction),
			SumMinor: totals[i].SumMinor,
		})
	}
	for i := range subs {
		s := &subs[i]
		lp := (*string)(nil)
		if s.LastPaidAt != nil {
			x := s.LastPaidAt.UTC().Format(time.RFC3339)
			lp = &x
		}
		out.Subscriptions = append(out.Subscriptions, agentports.FinanceSubscriptionBrief{
			ID: s.ID.String(), Name: s.Name, AmountMinor: s.AmountMinor, Currency: s.Currency,
			Cadence: string(s.Cadence), NextDueAt: s.NextDueAt.UTC().Format(time.RFC3339),
			Status: string(s.Status), LastPaidAt: lp,
		})
	}
	if len(out.Categories) == 0 && len(out.RecentTransactions) == 0 && len(out.Subscriptions) == 0 && len(out.CategoryTotals) == 0 {
		return nil
	}
	return out
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
